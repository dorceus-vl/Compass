import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import type { Env, Variables } from './types.ts';
import { authGuard } from './middleware/auth-guard.ts';
import auth from './routes/auth.ts';
import projects, { milestones } from './routes/projects.ts';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use('*', secureHeaders({
  contentSecurityPolicy: {
    defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    fontSrc: ["'self'", 'https://fonts.gstatic.com'], imgSrc: ["'self'", 'data:', 'blob:'], connectSrc: ["'self'"],
    workerSrc: ["'self'"], manifestSrc: ["'self'"], objectSrc: ["'none'"], baseUri: ["'self'"], formAction: ["'self'"], frameAncestors: ["'none'"],
  },
  strictTransportSecurity: 'max-age=31536000; includeSubDomains', xFrameOptions: 'DENY', referrerPolicy: 'strict-origin-when-cross-origin',
}));
app.use('/api/*', authGuard);
app.route('/api/auth', auth);
app.route('/api/projects', projects);
app.route('/api/milestones', milestones);
app.notFound((c) => c.json({ error: 'Not found' }, 404));
app.onError((err, c) => { console.error(err); return c.json({ error: 'Internal error' }, 500); });

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, _env: Env, _ctx: ExecutionContext) {
    // Task 5 adds the purges.
  },
} satisfies ExportedHandler<Env>;
