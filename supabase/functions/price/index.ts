// moongventory: 상품 페이지에서 "지금 가격"을 읽어 오는 함수
// 요청: POST { url: "https://www.kurly.com/goods/5006146" }
// 응답: { ok: true, price: 11080, name: "...", shop: "kurly" } 또는 { ok: false, reason: "..." }
import { createClient } from "npm:@supabase/supabase-js@2";

const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };

function shopOf(url: string){ if (/kurly\.com/i.test(url)) return "kurly"; if (/naver\.com/i.test(url)) return "naver"; if (/coupang\.com/i.test(url)) return "coupang"; return "other"; }
function num(s: string | undefined | null){ if (!s) return null; const n = Number(String(s).replace(/[^0-9.]/g, "")); return isFinite(n) && n > 0 ? n : null; }

function parseKurly(html: string){
  // 1) __NEXT_DATA__ 안의 상품 정보
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (m){
    try {
      const j = JSON.parse(m[1]);
      const q = j?.props?.pageProps?.product ?? j?.props?.pageProps?.dehydratedState ?? null;
      const txt = JSON.stringify(q ?? j);
      const dp = txt.match(/"discountedPrice":(\d+)/); const bp = txt.match(/"basePrice":(\d+)/); const rp = txt.match(/"retailPrice":(\d+)/);
      const nm = txt.match(/"name":"([^"]{2,80})"/);
      const price = num(dp?.[1]) ?? num(bp?.[1]) ?? num(rp?.[1]);
      if (price) return { price, name: nm?.[1] ?? null };
    } catch (_) { /* fall through */ }
  }
  // 2) 메타 태그
  const og = html.match(/property="product:price:amount" content="([^"]+)"/) ?? html.match(/"price":\s*"?(\d[\d,]*)"?/);
  const nm = html.match(/<meta property="og:title" content="([^"]+)"/);
  const price = num(og?.[1]);
  return price ? { price, name: nm?.[1] ?? null } : null;
}
function parseGeneric(html: string){
  const ld = html.match(/"price"\s*:\s*"?(\d[\d,]*)"?/); const og = html.match(/property="product:price:amount" content="([^"]+)"/);
  const nm = html.match(/<meta property="og:title" content="([^"]+)"/);
  const price = num(og?.[1]) ?? num(ld?.[1]);
  return price ? { price, name: nm?.[1] ?? null } : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    // 로그인한 사용자만
    const auth = req.headers.get("Authorization") ?? "";
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return new Response(JSON.stringify({ ok: false, reason: "로그인이 필요해요" }), { status: 401, headers: { ...cors, "Content-Type": "application/json" } });

    const { url } = await req.json();
    if (!url || !/^https?:\/\//.test(url)) return new Response(JSON.stringify({ ok: false, reason: "주소가 없어요" }), { headers: { ...cors, "Content-Type": "application/json" } });
    const shop = shopOf(url);
    const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9", "Accept": "text/html,*/*" }, redirect: "follow" });
    if (!r.ok) return new Response(JSON.stringify({ ok: false, reason: `상점이 거절했어요 (${r.status})`, shop }), { headers: { ...cors, "Content-Type": "application/json" } });
    const html = await r.text();
    const got = shop === "kurly" ? parseKurly(html) : parseGeneric(html);
    if (!got) return new Response(JSON.stringify({ ok: false, reason: "페이지에서 가격을 못 찾았어요", shop }), { headers: { ...cors, "Content-Type": "application/json" } });
    return new Response(JSON.stringify({ ok: true, shop, price: got.price, name: got.name, at: new Date().toISOString() }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, reason: String(e) }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
