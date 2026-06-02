import { NextRequest, NextResponse } from "next/server"

const API =
  process.env.API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://192.168.100.101:4000/api/v1"

/**
 * Same-origin proxy for the refresh endpoint. Lets the frontend silently
 * refresh access tokens without exposing the cross-origin cookie scope.
 *
 * In dev with separate ports we forward the incoming `Cookie` header straight
 * to the API and re-emit any `Set-Cookie` it returns so the browser stays
 * synced.
 */
export async function POST(req: NextRequest) {
  const cookie = req.headers.get("cookie") ?? ""

  const upstream = await fetch(`${API}/auth/refresh`, {
    method: "POST",
    headers: {
      cookie,
      "content-type": "application/json",
    },
    body: "{}",
  })

  const text = await upstream.text()
  const res = new NextResponse(text, { status: upstream.status })
  res.headers.set(
    "content-type",
    upstream.headers.get("content-type") ?? "application/json",
  )
  const setCookie = upstream.headers.get("set-cookie")
  if (setCookie) res.headers.set("set-cookie", setCookie)
  return res
}
