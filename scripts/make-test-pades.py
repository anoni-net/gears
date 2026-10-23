"""產生 PAdES 長期驗證的測試檔，由 tests/global-setup.ts 呼叫，檔案不進版控（anoni-net/gears#128）。

用 pyHanko（MIT）簽署，照它實際寫出的結構驗證查證的判斷：簽章附 RFC 3161 時間戳記，
簽完之後用增量更新加上 /DSS（憑證與撤銷清單）。本機用
`uv run --with pyhanko==0.29.0 python scripts/make-test-pades.py <輸出目錄>`。

- pades-lt.pdf：簽章、時間戳記與 /DSS（B-LT）
- pades-lta.pdf：再加上整份文件的時間戳記，以及它自己的 /DSS（B-LTA）
- pades-root.der：測試用的根憑證，簽署者、時間戳記服務與撤銷清單都由它簽發

憑證都是在這裡產生的，不對應任何真實的人或機構。pyHanko 的測試用時間戳記服務只支援 RSA，
時間戳記服務的金鑰用 RSA，其他用 ECDSA P-256
"""

import datetime as dt
import io
import sys
from pathlib import Path

from asn1crypto import crl as acrl
from asn1crypto import keys as akeys
from asn1crypto import x509 as ax509
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, rsa
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID
from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
from pyhanko.sign import signers
from pyhanko.sign.fields import SigSeedSubFilter
from pyhanko.sign.timestamps.dummy_client import DummyTimeStamper
from pyhanko_certvalidator import ValidationContext
from pyhanko_certvalidator.registry import SimpleCertificateStore

out = Path(sys.argv[1])
out.mkdir(parents=True, exist_ok=True)
now = dt.datetime.now(dt.timezone.utc)
CRL_URL = "http://crl.example.test/root.crl"
DER = serialization.Encoding.DER


def name(cn):
    return x509.Name([
        x509.NameAttribute(NameOID.COUNTRY_NAME, "TW"),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Gears Test"),
        x509.NameAttribute(NameOID.COMMON_NAME, cn),
    ])


def make_cert(cn, issuer=None, issuer_key=None, ca=False, eku=None, serial=1, use_rsa=False):
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048) if use_rsa else ec.generate_private_key(ec.SECP256R1())
    usage = x509.KeyUsage(
        digital_signature=not ca, content_commitment=not ca, key_encipherment=False, data_encipherment=False,
        key_agreement=False, key_cert_sign=ca, crl_sign=ca, encipher_only=False, decipher_only=False,
    )
    builder = (
        x509.CertificateBuilder()
        .subject_name(name(cn))
        .issuer_name(issuer.subject if issuer else name(cn))
        .public_key(key.public_key())
        .serial_number(serial)
        .not_valid_before(now - dt.timedelta(days=30))
        .not_valid_after(now + dt.timedelta(days=365))
        .add_extension(x509.BasicConstraints(ca=ca, path_length=None), critical=True)
        .add_extension(usage, critical=True)
        .add_extension(x509.SubjectKeyIdentifier.from_public_key(key.public_key()), critical=False)
    )
    if issuer:
        builder = builder.add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(issuer_key.public_key()), critical=False)
        point = x509.DistributionPoint([x509.UniformResourceIdentifier(CRL_URL)], None, None, None)
        builder = builder.add_extension(x509.CRLDistributionPoints([point]), critical=False)
    if eku:
        builder = builder.add_extension(x509.ExtendedKeyUsage(eku), critical=True)
    return builder.sign(issuer_key or key, hashes.SHA256()), key


# 沒有撤銷任何憑證的撤銷清單，pyHanko 驗證時用它，再存進 /DSS
def make_crl(issuer, issuer_key):
    return (
        x509.CertificateRevocationListBuilder()
        .issuer_name(issuer.subject)
        .last_update(now - dt.timedelta(hours=1))
        .next_update(now + dt.timedelta(days=7))
        .add_extension(x509.CRLNumber(1), critical=False)
        .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(issuer_key.public_key()), critical=False)
        .sign(issuer_key, hashes.SHA256())
    )


# 一頁的 PDF，寫著 Signed contract
def blank_pdf():
    text = b"BT /F1 14 Tf 20 100 Td (Signed contract) Tj ET"
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length %d >>\nstream\n%s\nendstream" % (len(text), text),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    buf = io.BytesIO()
    buf.write(b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    for i, obj in enumerate(objects, 1):
        offsets.append(buf.tell())
        buf.write(b"%d 0 obj\n%s\nendobj\n" % (i, obj))
    xref = buf.tell()
    buf.write(b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1))
    for offset in offsets:
        buf.write(b"%010d 00000 n \n" % offset)
    buf.write(b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objects) + 1, xref))
    return buf.getvalue()


def asn1_cert(cert):
    return ax509.Certificate.load(cert.public_bytes(DER))


def asn1_key(key):
    return akeys.PrivateKeyInfo.load(key.private_bytes(DER, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))


root, root_key = make_cert("Gears Test Root", ca=True)
leaf, leaf_key = make_cert("測試簽署人", root, root_key, serial=2)
tsa, tsa_key = make_cert("Gears Test TSA", root, root_key, eku=[ExtendedKeyUsageOID.TIME_STAMPING], serial=3, use_rsa=True)
crl = acrl.CertificateList.load(make_crl(root, root_key).public_bytes(DER))
(out / "pades-root.der").write_bytes(root.public_bytes(DER))

signer = signers.SimpleSigner(signing_cert=asn1_cert(leaf), signing_key=asn1_key(leaf_key), cert_registry=SimpleCertificateStore.from_certs([asn1_cert(root)]))
stamper = DummyTimeStamper(tsa_cert=asn1_cert(tsa), tsa_key=asn1_key(tsa_key), certs_to_embed=SimpleCertificateStore.from_certs([asn1_cert(root)]))
for kind in ["lt", "lta"]:
    context = ValidationContext(trust_roots=[asn1_cert(root)], crls=[crl], allow_fetching=False)
    meta = signers.PdfSignatureMetadata(
        field_name="Sig1", subfilter=SigSeedSubFilter.PADES, embed_validation_info=True, validation_context=context, use_pades_lta=kind == "lta",
    )
    signed = signers.PdfSigner(meta, signer=signer, timestamper=stamper).sign_pdf(IncrementalPdfFileWriter(io.BytesIO(blank_pdf())))
    (out / f"pades-{kind}.pdf").write_bytes(signed.getvalue())
