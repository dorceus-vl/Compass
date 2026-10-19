import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import type { Env, Variables } from './types.ts';
import { authGuard } from './middleware/auth-guard.ts';
import auth from './routes/auth.ts';
import projects, { milestones } from './routes/projects.ts';
import tasks from './routes/tasks.ts';
import views from './routes/views.ts';
import trash, { purgeTrash, purgeAudit, purgeSessions } from './routes/trash.ts';
import settings from './routes/settings.ts';
import { stepUpChallenge } from './lib/step-up.ts';

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
app.route('/api/tasks', tasks);
app.route('/api/trash', trash);
app.route('/api/settings', settings);
app.post('/api/step-up/challenge', stepUpChallenge);
app.route('/api', views);
app.notFound((c) => c.json({ error: 'Not found' }, 404));
app.onError((err, c) => { console.error(err); return c.json({ error: 'Internal error' }, 500); });

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(Promise.all([purgeTrash(env), purgeAudit(env), purgeSessions(env)]));
  },
} satisfies ExportedHandler<Env>;
