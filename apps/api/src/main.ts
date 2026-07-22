import { NestFactory } from "@nestjs/core"
import cookieParser from "cookie-parser"
import express, { json, urlencoded } from "express"
import helmet from "helmet"
import { join } from "path"
import { AppModule } from "./app.module"
import { HttpExceptionFilter } from "./common/filters/http-exception.filter"
import { TransformInterceptor } from "./common/interceptors/transform.interceptor"
import { RolesService } from "./modules/roles/roles.service"

async function bootstrap() {
  const app = await NestFactory.create(AppModule)

  // Make sure the built-in roles always exist so existing demo users
  // (admin/cpo/marketing/sales/dev) keep validating against the Role table.
  await app.get(RolesService).ensureBuiltins()

  const rawOrigin = process.env.WEB_ORIGIN ?? "http://localhost:3000"
  // Support comma-separated list: WEB_ORIGIN=http://localhost:3000,http://192.168.100.100:3000
  // Drop blanks (e.g. a trailing comma) so a stray entry can't poison the allowlist.
  const allowedOrigins = rawOrigin
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean)

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: "cross-origin" },
      frameguard: false,
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          "frame-ancestors": ["'self'", ...allowedOrigins],
        },
      },
    }),
  )
  app.use(express.static(join(process.cwd(), 'public')))
  app.use(cookieParser())
  app.use(json({ limit: "12mb" }))
  app.use(urlencoded({ extended: true, limit: "12mb" }))
  app.enableCors({
    origin: (origin, cb) => {
      // Allow same-origin / server-to-server (no Origin header)
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      // Reject by omitting the CORS headers — never throw here. A thrown error
      // propagates to Express as a 500, so a disallowed origin would surface as
      // "Internal server error" on the client instead of a clean CORS block.
       
      console.warn(`CORS: origin ${origin} not in WEB_ORIGIN allowlist`);
      cb(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })

  app.setGlobalPrefix("api/v1")
  app.useGlobalFilters(new HttpExceptionFilter())
  app.useGlobalInterceptors(new TransformInterceptor())

  app.enableShutdownHooks()

  const port = Number(process.env.PORT ?? 4000)
  await app.listen(port)
   
  console.log(`🚀 API ready at http://localhost:${port}/api/v1`)

  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.on(sig, async () => {
       
      console.log(`\n${sig} received — shutting down gracefully`)
      await app.close()
      process.exit(0)
    })
  }
}
bootstrap()
