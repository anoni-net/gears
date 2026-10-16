#!/bin/sh
# m6 上拉 anoni.net/gears 的 build 分支，由 ubuntu 的 crontab 每 5 分鐘執行一次：
#
#   */5 * * * * /home/ubuntu/gears-pull.sh
#
# 本檔是那支腳本的原始檔，改了之後要複製到 m6 的 /home/ubuntu/gears-pull.sh。
#
# build 分支由 .github/workflows/deploy.yml 推上來：site/ 是網站，deploy/ 是這裡要用的
# 模型清單（models.txt）與 nginx 標頭（nginx-headers.conf）。新的版本上線之前先做兩件事，
# 新頁面用得到的模型與標頭要先就位：
#
# 1. 模型：Whisper small、base 與 CAM++ 的單一檔案超過 GitHub 的 100 MB，不進 build 分支，
#    照清單下載到 $BASE/models/，比對 SHA-256 之後才放進去。路徑帶著模型的版本，
#    已經在的檔案不再下載
# 2. nginx 標頭：CSP 會跟著大模型的 commit 變。內容不同時換上、nginx -t 通過才 reload，
#    沒通過就退回原本那一份
#
# 只接受 fast-forward。build 分支的歷史被改寫時停下來寫進 log，不強制覆蓋，等人處理。
# 有更新或失敗時才寫 log。上一輪還沒跑完時這一輪直接略過（第一次下載模型要幾分鐘）。
set -eu

BASE=/srv/anoni-net-gears
REPO=$BASE/build
LOG=/home/ubuntu/gears-pull.log
SNIPPET=/etc/nginx/snippets/gears-headers.conf

log() { echo "$(date -Iseconds) $*" >>"$LOG"; }

exec 9>/tmp/gears-pull.lock
flock -n 9 || exit 0

git -C "$REPO" fetch -q origin build 2>>"$LOG"
before=$(git -C "$REPO" rev-parse HEAD)
target=$(git -C "$REPO" rev-parse FETCH_HEAD)

# 1. 模型
failed=0
git -C "$REPO" show "$target:deploy/models.txt" | while read -r url hash path; do
    [ -n "$url" ] || continue
    dest="$BASE/$path"
    [ -f "$dest" ] && continue
    mkdir -p "$(dirname "$dest")"
    tmp="$dest.part"
    if curl -fsSL --retry 3 -o "$tmp" "$url" 2>>"$LOG" && [ "$(sha256sum "$tmp" | cut -d' ' -f1)" = "$hash" ]; then
        mv "$tmp" "$dest"
        log "下載 $path"
    else
        rm -f "$tmp"
        log "下載失敗或 SHA-256 不符：$path"
        exit 1
    fi
done || failed=1
if [ "$failed" = 1 ]; then
    log "模型沒有到齊，停在 $before，下一輪再試"
    exit 1
fi

# 2. nginx 標頭
new=$(mktemp)
git -C "$REPO" show "$target:deploy/nginx-headers.conf" >"$new"
if ! cmp -s "$new" "$SNIPPET"; then
    prev=$(mktemp)
    [ -f "$SNIPPET" ] && cp "$SNIPPET" "$prev"
    sudo install -m 644 "$new" "$SNIPPET"
    if sudo nginx -t -q 2>>"$LOG"; then
        sudo systemctl reload nginx
        log "換上新的 nginx 標頭"
    else
        if [ -s "$prev" ]; then sudo install -m 644 "$prev" "$SNIPPET"; else sudo rm -f "$SNIPPET"; fi
        log "新的 nginx 標頭沒有通過 nginx -t，退回原本的，停在 $before"
        rm -f "$new" "$prev"
        exit 1
    fi
    rm -f "$prev"
fi
rm -f "$new"

# 3. 網站
if ! git -C "$REPO" merge --ff-only -q "$target" 2>>"$LOG"; then
    log "無法 fast-forward，停在 $before，需要人工處理"
    exit 1
fi
if [ "$before" != "$target" ]; then
    log "$before -> $target $(git -C "$REPO" log -1 --format=%s)"
fi
