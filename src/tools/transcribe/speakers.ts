// 分辨說話者：每一段逐字稿取一個聲紋（CAM++ 的 192 維向量，在 src/ui/transcribe.worker.ts
// 算），這裡把聲紋分群，標成「說話者 1、2、3」。
//
// 用 Whisper 的段落當單位，不另外跑分段模型。實測四位朗讀者剪接的錄音（含切在句子中間、
// 沒有停頓就換人、加了噪音的版本），每秒標對 98% 以上，人數都估對。錯誤集中在換人點落在
// 同一段裡的時候，那一段只能整段標給一個人。
//
// 分群用平均連結的階層式分群，相似度是餘弦，低於 THRESHOLD 就不再合併。總共說不到
// MIN_SECONDS 的群併到最相近的大群，不做的話單人的錄音會被分成好幾個人。

export const THRESHOLD = 0.5;
export const MIN_SECONDS = 10;

export function normalize(v: ArrayLike<number>): Float32Array {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i]! * v[i]!;
  const norm = Math.sqrt(sum) || 1;
  return Float32Array.from(v, (x) => x / norm);
}

const dot = (a: Float32Array, b: Float32Array) => {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i]! * b[i]!;
  return sum;
};

// embeddings 依時間排序、已經 normalize，seconds 是每段的長度。回傳每段的說話者編號，
// 0 是最先開口的人
export function cluster(embeddings: Float32Array[], seconds: number[], threshold = THRESHOLD, minSeconds = MIN_SECONDS): number[] {
  const n = embeddings.length;
  if (n <= 1) return embeddings.map(() => 0);

  // 平均連結的分群樹，用 nearest-neighbor chain 建，時間是 O(n²)。兩小時的錄音約兩千段，
  // 每次合併都掃整個矩陣的做法（O(n³)）在瀏覽器裡要算好幾分鐘
  const distance = new Float32Array(n * n);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) distance[i * n + j] = distance[j * n + i] = 1 - dot(embeddings[i]!, embeddings[j]!);
  const size = new Float64Array(n).fill(1);
  const active = new Uint8Array(n).fill(1);
  const parent = Int32Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const cut = 1 - threshold;
  const chain: number[] = [];
  let remaining = n;
  while (remaining > 1) {
    if (!chain.length) chain.push(active.indexOf(1));
    const a = chain.at(-1)!;
    const previous = chain.length > 1 ? chain.at(-2)! : -1;
    let b = previous;
    let best = previous >= 0 ? distance[a * n + previous]! : Infinity;
    for (let j = 0; j < n; j++) {
      if (!active[j] || j === a) continue;
      if (distance[a * n + j]! < best) {
        best = distance[a * n + j]!;
        b = j;
      }
    }
    if (b !== previous) {
      chain.push(b);
      continue;
    }
    // 互為最近的兩群合併，留下 a。平均連結的分群樹是單調的，所以距離低於門檻的合併，
    // 剛好組成在門檻停下來時的那幾群
    chain.length -= 2;
    for (let k = 0; k < n; k++) {
      if (!active[k] || k === a || k === b) continue;
      distance[a * n + k] = distance[k * n + a] = (size[a]! * distance[a * n + k]! + size[b]! * distance[b * n + k]!) / (size[a]! + size[b]!);
    }
    size[a]! += size[b]!;
    active[b] = 0;
    remaining--;
    if (best < cut) parent[find(b)] = find(a);
  }

  // 每一群的時長與聲紋中心（依時長加權）
  const groups = new Map<number, { members: number[]; seconds: number; sum: Float32Array }>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    let group = groups.get(root);
    if (!group) groups.set(root, (group = { members: [], seconds: 0, sum: new Float32Array(embeddings[i]!.length) }));
    group.members.push(i);
    group.seconds += seconds[i]!;
    for (let d = 0; d < group.sum.length; d++) group.sum[d]! += embeddings[i]![d]! * seconds[i]!;
  }
  let list = [...groups.values()];
  let big = list.filter((g) => g.seconds >= minSeconds);
  // 整段錄音都很短時，至少留下說最久的那一群
  if (!big.length) big = [list.reduce((a, b) => (b.seconds > a.seconds ? b : a))];
  for (const small of list.filter((g) => !big.includes(g))) {
    const center = normalize(small.sum);
    const target = big.reduce((a, b) => (dot(center, normalize(b.sum)) > dot(center, normalize(a.sum)) ? b : a));
    target.members.push(...small.members);
  }
  list = big.sort((a, b) => Math.min(...a.members) - Math.min(...b.members));
  const labels = new Array<number>(n);
  list.forEach((group, index) => {
    for (const m of group.members) labels[m] = index;
  });
  return labels;
}

// 太短的段落（不到 MIN_EMBED_SECONDS）算不出可靠的聲紋，embedding 給 null，沿用前一段的說話者
// （開頭就太短的用後一段的）
export const MIN_EMBED_SECONDS = 0.3;

export function assignSpeakers(embeddings: (Float32Array | null)[], seconds: number[]): number[] {
  const index = embeddings.flatMap((e, i) => (e ? [i] : []));
  const labels = cluster(
    index.map((i) => embeddings[i]!),
    index.map((i) => seconds[i]!),
  );
  const out = new Array<number>(embeddings.length).fill(-1);
  index.forEach((i, k) => (out[i] = labels[k]!));
  for (let i = 1; i < out.length; i++) if (out[i] === -1) out[i] = out[i - 1]!;
  for (let i = out.length - 2; i >= 0; i--) if (out[i] === -1) out[i] = out[i + 1]!;
  return out.map((label) => Math.max(0, label));
}
