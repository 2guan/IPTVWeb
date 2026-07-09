import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { initDb } from './db.js';
import { initGeoIP } from './geoip.js';
import { initScheduler } from './scheduler.js';

// Routers
import authRouter from './routes/auth.js';
import sourcesRouter from './routes/sources.js';
import subscriptionsRouter from './routes/subscriptions.js';
import epgRouter from './routes/epg.js';
import settingsRouter from './routes/settings.js';
import exportRouter from './routes/export.js';
import optimizerRouter from './routes/optimizer.js';

const app = express();
const PORT = process.env.PORT || 4010;

// Enable CORS for API development
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 1. Initialize DB and Services
console.log('Initializing IPTV Management System backend...');
initDb();

// Async services initialization
async function startServices() {
  await initGeoIP();
  initScheduler();
}
startServices().catch(err => {
  console.error('Error starting async background services:', err);
});

// 2. Bind Public Export/Subscription Router directly to root '/'
app.use('/', exportRouter);

// 3. Bind Admin Management API Routers
app.use('/api/auth', authRouter);
app.use('/api/sources', sourcesRouter);
app.use('/api/subscriptions', subscriptionsRouter);
app.use('/api/epg', epgRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/optimizer', optimizerRouter);

// 4. Host static files for frontend build
const publicPath = path.resolve('./public');
if (!fs.existsSync(publicPath)) {
  fs.mkdirSync(publicPath, { recursive: true });
}
app.use(express.static(publicPath));

// 5. Fallback for React Router single page app
app.get('*', (req, res, next) => {
  // Skip if it looks like an API route
  if (req.path.startsWith('/api/') || req.path.startsWith('/m3u') || req.path.startsWith('/txt') || req.path.startsWith('/ipv')) {
    return next();
  }
  const indexPath = path.join(publicPath, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.send('IPTV Admin Backend is running. Frontend static index.html not found under ./public');
  }
});

// Start listening
app.listen(PORT, '0.0.0.0', () => {
  console.log(`IPTV Management backend is listening on http://0.0.0.0:${PORT}`);
});
