// 測試用的信。內容是虛構的，網域用 example.* 與保留給文件使用的 IP（192.0.2.0/24、198.51.100.0/24）

const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64");

export const PDF_BYTES = "%PDF-1.4\n% attachment\n";

// 正常的電子報：寄件驗證都通過，退信地址用子網域，主旨是 UTF-8 編碼的中文，
// 內文是 quoted-printable，附件的檔名用 RFC 2231 編碼
export const LEGIT_EML = [
  "Delivered-To: reader@example.net",
  "Received: by 2002:a05:6a10:1234 with SMTP id abc;",
  "        Thu, 16 Oct 2026 02:05:10 -0700 (PDT)",
  "ARC-Authentication-Results: i=1; mx.example.net;",
  "       dkim=pass header.i=@news.example.org header.s=s1;",
  "       spf=pass smtp.mailfrom=bounce@mail.news.example.org;",
  "       dmarc=pass (p=REJECT) header.from=news.example.org",
  "Authentication-Results: mx.example.net;",
  "       dkim=pass header.i=@news.example.org header.s=s1 header.b=AbCd;",
  "       spf=pass (example.net: domain of bounce@mail.news.example.org designates 192.0.2.10 as permitted sender) smtp.mailfrom=bounce@mail.news.example.org;",
  "       dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=news.example.org",
  "Return-Path: <bounce@mail.news.example.org>",
  "Received: from mail.news.example.org (mail.news.example.org. [192.0.2.10])",
  "        by mx.example.net with ESMTPS id x1;",
  "        Thu, 16 Oct 2026 02:05:09 -0700 (PDT)",
  "DKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d=news.example.org; s=s1; h=from:to:subject; bh=x; b=y",
  `From: =?UTF-8?B?${b64("社群電子報")}?= <hello@news.example.org>`,
  "To: reader@example.net",
  `Subject: =?UTF-8?B?${b64("十月活動")}?= =?UTF-8?Q?=E9=80=9A=E7=9F=A5?=`,
  "Date: Thu, 16 Oct 2026 17:05:00 +0800",
  "Message-ID: <abc123@news.example.org>",
  "X-Mailer: Newsletter 2.1",
  "MIME-Version: 1.0",
  'Content-Type: multipart/mixed; boundary="BOUND"',
  "",
  "--BOUND",
  "Content-Type: text/plain; charset=utf-8",
  "Content-Transfer-Encoding: quoted-printable",
  "",
  "=E6=B4=BB=E5=8B=95=E8=A9=B3=E6=83=85=EF=BC=9Ahttps://news.example.org/events/10?utm_source=3Dmail.",
  "",
  "--BOUND",
  "Content-Type: application/pdf",
  "Content-Disposition: attachment; filename*=UTF-8''%E5%A0%B1%E5%91%8A.pdf",
  "Content-Transfer-Encoding: base64",
  "",
  b64(PDF_BYTES),
  "--BOUND--",
  "",
].join("\r\n");

// 冒用銀行名義的信：顯示名稱寫了另一個信箱，回覆地址換成別的網域，寄件驗證沒有通過。
// 下面那一筆寫著 pass 的 Authentication-Results 是寄件的人自己加的，不能信
export const PHISH_EML = [
  "Authentication-Results: mx.example.net; spf=softfail smtp.mailfrom=alert@secure-login.example.com; dkim=none; dmarc=fail (p=NONE) header.from=secure-login.example.com",
  "Received: from unknown (HELO pc) ([198.51.100.7])",
  "        by mx.example.net with SMTP id y2; Wed, 15 Oct 2026 23:00:00 +0000",
  "Authentication-Results: fake.example.com; spf=pass; dkim=pass; dmarc=pass",
  'From: "service@bank.example" <alert@secure-login.example.com>',
  "Reply-To: collect@another.example",
  "To: reader@example.net",
  "Subject: Account locked",
  "Date: Mon, 01 Jan 2024 00:00:00 +0000",
  "MIME-Version: 1.0",
  'Content-Type: multipart/mixed; boundary="B2"',
  "",
  "--B2",
  "Content-Type: text/html; charset=utf-8",
  "",
  '<a href="https://secure-login.example.com/verify?id=1&amp;x=2">Verify</a>',
  "--B2",
  'Content-Type: text/html; name="invoice.html"',
  "Content-Transfer-Encoding: base64",
  "",
  b64("<html>login</html>"),
  "--B2--",
  "",
].join("\r\n");
