import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function gasUrl(): URL {
  const raw = process.env.NEXT_PUBLIC_GAS_URL;
  if (!raw) throw new Error("NEXT_PUBLIC_GAS_URL belum diatur.");
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.hostname !== "script.google.com" || !url.pathname.endsWith("/exec")) {
    throw new Error("NEXT_PUBLIC_GAS_URL bukan URL Web App Apps Script yang valid.");
  }
  return url;
}

async function forward(method: "GET" | "POST", body?: string) {
  try {
    const url = gasUrl();
    if (method === "GET") url.searchParams.set("action", "getConfig");
    const response = await fetch(url, {
      method,
      headers: method === "POST" ? { "Content-Type": "text/plain;charset=utf-8" } : undefined,
      body,
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(28000),
    });
    if (!response.ok) throw new Error(`Web App GAS merespons HTTP ${response.status}.`);
    const raw = await response.text();
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error("Respons GAS bukan JSON. Periksa akses deployment Web App.");
    }
    if (!data || typeof data !== "object") throw new Error("Format respons GAS tidak valid.");
    return NextResponse.json(data, {
      status: (data as { ok?: boolean }).ok === false ? 422 : 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Koneksi ke GAS gagal.";
    return NextResponse.json({ ok: false, error: message }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}

export async function GET() {
  return forward("GET");
}

export async function POST(request: NextRequest) {
  const body = await request.text();
  if (body.length > 120000) {
    return NextResponse.json({ ok: false, error: "Payload terlalu besar." }, { status: 413 });
  }
  try {
    JSON.parse(body);
  } catch {
    return NextResponse.json({ ok: false, error: "Body harus JSON." }, { status: 400 });
  }
  return forward("POST", body);
}
