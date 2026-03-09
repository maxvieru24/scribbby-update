require('dotenv').config();
const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const ffmpegPath = require('ffmpeg-static');
const multer = require('multer');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB (Groq limit)
});
const { transcribe } = require('./lib/transcription');
const { forceAlign, wordsToSegments, transcribeWithDiarization, wordsWithSpeakersToSegments } = require('./lib/elevenlabs-alignment');
const { getAnonClient, getServiceClient } = require('./lib/supabase');
const Stripe = require('stripe');

const useAria2 = process.env.USE_ARIA2 === '1' || process.env.USE_ARIA2 === 'true';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

function getYtdlpPath() {
  if (process.env.YT_DLP_PATH) return process.env.YT_DLP_PATH;
  const localExe = path.join(__dirname, 'bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
  if (fs.existsSync(localExe)) return localExe;
  return 'yt-dlp';
}

function isValidUrl(s) {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

app.post('/download', (req, res) => {
  // #region agent log
  fetch('http://127.0.0.1:7938/ingest/81917f77-1bdb-49d4-82f8-86da6cc3d267',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'bb9030'},body:JSON.stringify({sessionId:'bb9030',location:'server.js:entry',message:'POST /download hit',data:{url:(req.body&&req.body.url)!=null?String(req.body.url).trim():'',wantWav:!!(req.body&&req.body.format==='wav')},timestamp:Date.now(),hypothesisId:'H1'})}).catch(()=>{});
  // #endregion
  const url = req.body && req.body.url != null ? String(req.body.url).trim() : '';
  const wantWav = req.body && req.body.format === 'wav';
  if (!url || !isValidUrl(url)) {
    // #region agent log
    fetch('http://127.0.0.1:7938/ingest/81917f77-1bdb-49d4-82f8-86da6cc3d267',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'bb9030'},body:JSON.stringify({sessionId:'bb9030',location:'server.js:validation_fail',message:'validation failed',data:{url:url||'(empty)'},timestamp:Date.now(),hypothesisId:'H2'})}).catch(()=>{});
    // #endregion
    return res.status(400).json({ error: 'Invalid or missing URL' });
  }

  const ytdlpPath = getYtdlpPath();
  const ytdlpStderr = [];

  // Fast path: prefer webm (249/251) then m4a (140/139) then bestaudio/best so more videos work.
  const format = wantWav ? '251/140/249/139/bestaudio/best' : '249/251/140/139/bestaudio/best';
  const baseArgs = ['-f', format, '--no-warnings', '--no-playlist', '--no-check-certificates', '--concurrent-fragments', '8'];
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtube.com') || u.hostname.includes('youtu.be')) {
      baseArgs.push('--extractor-args', 'youtube:player_client=android');
    }
  } catch (_) {}

  if (wantWav) {
  const args = [...baseArgs, '-o', '-', url];
  // #region agent log
  fetch('http://127.0.0.1:7938/ingest/81917f77-1bdb-49d4-82f8-86da6cc3d267',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'bb9030'},body:JSON.stringify({sessionId:'bb9030',location:'server.js:before_spawn',message:'about to spawn yt-dlp',data:{ytdlpPath,format},timestamp:Date.now(),hypothesisId:'H2'})}).catch(()=>{});
  // #endregion
  const ytdlp = spawn(ytdlpPath, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });
  // #region agent log
  fetch('http://127.0.0.1:7938/ingest/81917f77-1bdb-49d4-82f8-86da6cc3d267',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'bb9030'},body:JSON.stringify({sessionId:'bb9030',location:'server.js:after_spawn',message:'yt-dlp spawned',data:{pid:ytdlp.pid},timestamp:Date.now(),hypothesisId:'H3'})}).catch(()=>{});
  // #endregion
    const ffmpeg = spawn(
      ffmpegPath,
      ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-ac', '1', '-ar', '16000', '-f', 'wav', 'pipe:1'],
      { stdio: ['pipe', 'pipe', 'pipe'], shell: false }
    );
    ytdlp.stdout.pipe(ffmpeg.stdin);
    ytdlp.stderr.on('data', (d) => {
      ytdlpStderr.push(d);
      process.stderr.write(d);
    });
    ffmpeg.stderr.on('data', (d) => process.stderr.write(d));
    ytdlp.on('error', (err) => {
      if (!res.headersSent) res.status(500).json({ error: 'yt-dlp not found or failed to start', detail: err.message });
    });
    ffmpeg.on('error', (err) => {
      if (!res.headersSent) res.status(500).json({ error: 'ffmpeg not found or failed to start', detail: err.message });
    });
    ytdlp.on('close', (code) => {
      ffmpeg.stdin.end();
      if (code !== 0 && !res.headersSent) {
        const stderrText = Buffer.concat(ytdlpStderr).toString('utf8').trim().slice(-500);
        res.status(502).json({ error: 'yt-dlp failed', code, detail: stderrText || `Exit code ${code}` });
      }
    });
    ffmpeg.on('close', (code) => {
      if (code !== 0 && !res.headersSent) res.status(502).json({ error: 'ffmpeg failed', code });
    });
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'audio/wav');
      res.setHeader('Content-Disposition', 'attachment; filename="audio.wav"');
      res.flushHeaders();
      const out = ffmpeg.stdout;
      out.pipe(res);
      out.on('error', (err) => { if (!res.destroyed) res.destroy(err); });
      res.on('error', () => out.destroy());
    }
    return;
  }

  if (useAria2) {
    const tempDir = os.tmpdir();
    const tempBase = `ytdlp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const outputTemplate = path.join(tempDir, tempBase + '.%(ext)s');
    const aria2Args = [...baseArgs, '-o', outputTemplate, '--external-downloader', 'aria2c', '--external-downloader-args', '-x 16 -k 1M', url];
    const ytdlpA = spawn(ytdlpPath, aria2Args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    const stderrA = [];
    ytdlpA.stderr.on('data', (d) => { stderrA.push(d); process.stderr.write(d); });
    const unlinkTemp = (filePath) => { try { if (filePath) fs.unlinkSync(filePath); } catch (_) {} };
    ytdlpA.on('error', (err) => {
      if (!res.headersSent) res.status(500).json({ error: 'yt-dlp not found or failed to start', detail: err.message });
    });
    ytdlpA.on('close', (code) => {
      if (code !== 0) {
        const txt = Buffer.concat(stderrA).toString('utf8');
        const aria2Unavailable = /aria2|external.downloader|not found|No such file|'aria2c'/i.test(txt);
        if (aria2Unavailable && !res.headersSent) {
          const args = [...baseArgs, '-o', '-', url];
          const ytdlp2 = spawn(ytdlpPath, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false });
          ytdlp2.stderr.on('data', (d) => process.stderr.write(d));
          ytdlp2.on('error', (err) => { if (!res.headersSent) res.status(500).json({ error: 'yt-dlp failed', detail: err.message }); });
          ytdlp2.on('close', (code2) => {
            if (code2 !== 0 && !res.headersSent) res.status(502).json({ error: 'yt-dlp failed', code: code2 });
          });
          res.setHeader('Content-Type', 'audio/webm');
          res.setHeader('Content-Disposition', 'attachment; filename="audio.webm"');
          res.flushHeaders();
          ytdlp2.stdout.pipe(res);
          ytdlp2.stdout.on('error', (e) => { if (!res.destroyed) res.destroy(e); });
          res.on('error', () => ytdlp2.stdout.destroy());
          return;
        }
        if (!res.headersSent) res.status(502).json({ error: 'yt-dlp failed', code, detail: txt.trim().slice(-500) || `Exit code ${code}` });
        return;
      }
      if (res.headersSent) return;
      const files = fs.readdirSync(tempDir).filter((f) => f.startsWith(tempBase));
      const outFile = files.length ? path.join(tempDir, files[0]) : null;
      if (!outFile || !fs.existsSync(outFile)) {
        if (!res.headersSent) res.status(502).json({ error: 'yt-dlp failed', detail: 'No output file' });
        return;
      }
      const ext = path.extname(outFile).toLowerCase().slice(1);
      const contentType = ext === 'webm' ? 'audio/webm' : ext === 'm4a' ? 'audio/mp4' : 'application/octet-stream';
      const filename = `audio.${ext}`;
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.flushHeaders();
      const stream = fs.createReadStream(outFile);
      stream.pipe(res);
      stream.on('error', (err) => { unlinkTemp(outFile); if (!res.destroyed) res.destroy(err); });
      res.on('error', () => { stream.destroy(); unlinkTemp(outFile); });
      res.on('finish', () => unlinkTemp(outFile));
    });
    return;
  }

  // Fast path: pipe yt-dlp directly to response (webm)
  const args = [...baseArgs, '-o', '-', url];
  // #region agent log
  fetch('http://127.0.0.1:7938/ingest/81917f77-1bdb-49d4-82f8-86da6cc3d267',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'bb9030'},body:JSON.stringify({sessionId:'bb9030',location:'server.js:before_spawn',message:'about to spawn yt-dlp',data:{ytdlpPath,format},timestamp:Date.now(),hypothesisId:'H2'})}).catch(()=>{});
  // #endregion
  const ytdlp = spawn(ytdlpPath, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false });
  // #region agent log
  fetch('http://127.0.0.1:7938/ingest/81917f77-1bdb-49d4-82f8-86da6cc3d267',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'bb9030'},body:JSON.stringify({sessionId:'bb9030',location:'server.js:after_spawn',message:'yt-dlp spawned',data:{pid:ytdlp.pid},timestamp:Date.now(),hypothesisId:'H3'})}).catch(()=>{});
  // #endregion
  ytdlp.stderr.on('data', (d) => {
    ytdlpStderr.push(d);
    process.stderr.write(d);
  });
  ytdlp.on('error', (err) => {
    if (!res.headersSent) res.status(500).json({ error: 'yt-dlp not found or failed to start', detail: err.message });
  });
  ytdlp.on('close', (code) => {
    // #region agent log
    fetch('http://127.0.0.1:7938/ingest/81917f77-1bdb-49d4-82f8-86da6cc3d267',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'bb9030'},body:JSON.stringify({sessionId:'bb9030',location:'server.js:ytdlp_close',message:'yt-dlp close',data:{code},timestamp:Date.now(),hypothesisId:'H3'})}).catch(()=>{});
    // #endregion
    if (code !== 0 && !res.headersSent) {
      const stderrText = Buffer.concat(ytdlpStderr).toString('utf8').trim().slice(-500);
      res.status(502).json({ error: 'yt-dlp failed', code, detail: stderrText || `Exit code ${code}` });
    }
  });
  let firstChunkLogged = false;
  ytdlp.stdout.once('data', (chunk) => {
    if (!firstChunkLogged) {
      firstChunkLogged = true;
      // #region agent log
      fetch('http://127.0.0.1:7938/ingest/81917f77-1bdb-49d4-82f8-86da6cc3d267',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'bb9030'},body:JSON.stringify({sessionId:'bb9030',location:'server.js:first_stdout',message:'first ytdlp stdout chunk',data:{len:chunk&&chunk.length},timestamp:Date.now(),hypothesisId:'H4'})}).catch(()=>{});
      // #endregion
    }
  });
  if (!res.headersSent) {
    res.setHeader('Content-Type', 'audio/webm');
    res.setHeader('Content-Disposition', 'attachment; filename="audio.webm"');
    res.flushHeaders();
    // #region agent log
    fetch('http://127.0.0.1:7938/ingest/81917f77-1bdb-49d4-82f8-86da6cc3d267',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'bb9030'},body:JSON.stringify({sessionId:'bb9030',location:'server.js:headers_sent',message:'response headers flushed',data:{},timestamp:Date.now(),hypothesisId:'H5'})}).catch(()=>{});
    // #endregion
    ytdlp.stdout.pipe(res);
    ytdlp.stdout.on('error', (err) => { if (!res.destroyed) res.destroy(err); });
    res.on('error', () => ytdlp.stdout.destroy());
  }
});

function getSourcePlatform(urlString) {
  try {
    const host = new URL(urlString).hostname.toLowerCase();
    if (host.includes('youtube') || host.includes('youtu.be')) return 'youtube';
    if (host.includes('instagram')) return 'instagram';
    if (host.includes('tiktok')) return 'tiktok';
    if (host.includes('twitter.com') || host.includes('x.com')) return 'twitter';
    if (host.includes('vimeo')) return 'vimeo';
    if (host.includes('facebook') || host.includes('fb.watch') || host.includes('fb.com')) return 'facebook';
    if (host.includes('twitch')) return 'twitch';
    if (host.includes('soundcloud')) return 'soundcloud';
    if (host.includes('spotify')) return 'spotify';
    return host.replace(/^www\./, '');
  } catch (_) {
    return null;
  }
}

function getWavDurationSec(buffer) {
  // 16 kHz mono 16-bit WAV: 32000 bytes/sec; 44-byte header
  if (!buffer || buffer.length <= 44) return 0;
  return Math.max(0, Math.round((buffer.length - 44) / 32000));
}

// Transcribe audio from URL using Groq Whisper V3 Large Turbo
app.post('/transcribe', async (req, res) => {
  const transcribeStart = Date.now();
  const url = req.body && req.body.url != null ? String(req.body.url).trim() : '';
  if (!url || !isValidUrl(url)) {
    return res.status(400).json({ error: 'Invalid or missing URL' });
  }
  const key = process.env.GROQ_API_KEY;
  if (!key) {
    return res.status(503).json({ error: 'Transcription unavailable: GROQ_API_KEY not set' });
  }

  // Resolve user if logged in (Bearer token or body.access_token)
  let userId = null;
  let userEmail = null;
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '') || req.body?.access_token;
  if (token) {
    const anon = getAnonClient();
    if (anon) {
      const { data: { user }, error } = await anon.auth.getUser(token);
      if (!error && user) {
        userId = user.id;
        userEmail = user.email ?? null;
      }
    }
  }

  // Logged-in only: free users get daily and duration limits; pro users get none
  let isFree = false;
  if (userId) {
    const supabase = getServiceClient();
    if (supabase) {
      const { data: profile } = await supabase.from('profiles').select('plan').eq('id', userId).single();
      isFree = profile?.plan !== 'pro';
    } else {
      isFree = true;
    }
    if (isFree) {
      const startOfTodayUtc = new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z';
      const supabaseForCount = getServiceClient();
      if (supabaseForCount) {
        const { count, error: countErr } = await supabaseForCount
          .from('transcription_jobs')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', userId)
          .gte('created_at', startOfTodayUtc);
        if (!countErr && count != null && count >= 3) {
          return res.status(403).json({
            error: 'Free limit: 3 transcriptions per day. Upgrade to Pro for more.',
          });
        }
      }
    }
  }

  const ytdlpPath = getYtdlpPath();
  const format = '251/140/249/139/bestaudio/best';
  const baseArgs = ['-f', format, '--no-warnings', '--no-playlist', '--no-check-certificates', '--concurrent-fragments', '8'];
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtube.com') || u.hostname.includes('youtu.be')) {
      baseArgs.push('--extractor-args', 'youtube:player_client=android');
    }
  } catch (_) {}

  const args = [...baseArgs, '-o', '-', url];
  const ytdlp = spawn(ytdlpPath, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false });
  const ffmpeg = spawn(
    ffmpegPath,
    ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-ac', '1', '-ar', '16000', '-f', 'wav', 'pipe:1'],
    { stdio: ['pipe', 'pipe', 'pipe'], shell: false }
  );
  ytdlp.stdout.pipe(ffmpeg.stdin);
  const chunks = [];
  ffmpeg.stdout.on('data', (chunk) => chunks.push(chunk));
  const stderr = [];
  ytdlp.stderr.on('data', (d) => { stderr.push(d); process.stderr.write(d); });
  ffmpeg.stderr.on('data', (d) => process.stderr.write(d));

  await new Promise((resolve, reject) => {
    ytdlp.on('error', reject);
    ffmpeg.on('error', reject);
    ytdlp.on('close', (code) => {
      ffmpeg.stdin.end();
      if (code !== 0) {
        const msg = Buffer.concat(stderr).toString('utf8').trim().slice(-500);
        reject(new Error(`yt-dlp failed: ${code} ${msg || ''}`));
      }
    });
    ffmpeg.on('close', (code) => {
      if (code !== 0) reject(new Error(`ffmpeg failed: ${code}`));
      else resolve();
    });
  });

  const audioBuffer = Buffer.concat(chunks);
  if (audioBuffer.length === 0) {
    return res.status(502).json({ error: 'No audio received from URL' });
  }
  // Groq Whisper limit is 25 MB
  if (audioBuffer.length > 25 * 1024 * 1024) {
    return res.status(413).json({ error: 'Audio too long for transcription (max 25 MB). Use a shorter clip or download only.' });
  }

  // Free user: max 30 min per link
  if (userId && isFree) {
    const duration_sec = getWavDurationSec(audioBuffer);
    if (duration_sec > 1800) {
      return res.status(403).json({
        error: 'Free limit: max 30 minutes per link. Upgrade to Pro for longer audio.',
      });
    }
  }

  try {
    let text = '';
    let segments = [];
    if (process.env.ELEVENLABS_API_KEY) {
      try {
        const sttResult = await transcribeWithDiarization(audioBuffer, 'audio.wav');
        text = sttResult.text || '';
        if (sttResult.words?.length > 0) {
          segments = wordsWithSpeakersToSegments(sttResult.words);
        }
        if (segments.length === 0 && text) {
          const { words } = await forceAlign(audioBuffer, text, 'audio.wav');
          if (words.length > 0) segments = wordsToSegments(words);
        }
      } catch (elErr) {
        console.error('ElevenLabs STT failed:', elErr.message);
        const whisperResult = await transcribe(audioBuffer, 'audio.wav', undefined, { verbose: true });
        text = whisperResult.text || '';
        segments = whisperResult.segments || [];
      }
    } else {
      const whisperResult = await transcribe(audioBuffer, 'audio.wav', undefined, { verbose: true });
      text = whisperResult.text || '';
      segments = whisperResult.segments || [];
    }
    const completedAt = new Date().toISOString();
    const duration_sec = getWavDurationSec(audioBuffer);
    const source_platform = getSourcePlatform(url);
    const processing_sec = Math.round((Date.now() - transcribeStart) / 1000);

    // Respond immediately so the client doesn't wait for DB
    res.json({
      text: text || '',
      segments,
      audioBase64: audioBuffer.toString('base64'),
      audioContentType: 'audio/wav',
    });

    // Run DB work after response (fire-and-forget)
    const supabase = getServiceClient();
    const segmentsToSave = segments;
    const audioBufferToSave = audioBuffer;
    if (supabase) {
      (async () => {
        try {
          const { data: row, error: insertErr } = await supabase.from('transcription_jobs').insert({
            user_id: userId,
            user_email: userEmail,
            status: 'completed',
            source_type: 'url',
            source_url: url,
            source_platform: source_platform,
            progress: 100,
            step: 'completed',
            duration_sec: duration_sec || null,
            processing_sec: processing_sec,
            transcript_text: text || null,
            segments: segmentsToSave?.length ? segmentsToSave : null,
            completed_at: completedAt,
          }).select('id').single();
          if (!insertErr && userId) {
            await supabase.rpc('increment_profile_jobs_created_total', { p_user_id: userId });
          }
          // Upload audio so history can play/seek. Create bucket "transcription-audio" (public) in Supabase Dashboard if needed.
          if (row?.id && audioBufferToSave?.length && process.env.SUPABASE_URL) {
            try {
              const { error: uploadErr } = await supabase.storage.from('transcription-audio').upload(row.id + '.wav', audioBufferToSave, { contentType: 'audio/wav', upsert: true });
              if (!uploadErr) {
                const publicUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/transcription-audio/${row.id}.wav`;
                await supabase.from('transcription_jobs').update({ audio_url: publicUrl }).eq('id', row.id);
              }
            } catch (uploadErr) {
              console.error('Audio upload to storage failed:', uploadErr?.message || uploadErr);
            }
          }
        } catch (dbErr) {
          console.error('Failed to save transcription job:', dbErr);
        }
      })();
    }
  } catch (err) {
    console.error('Transcription error:', err);
    res.status(502).json({ error: err.message || 'Transcription failed' });
  }
});

// Transcribe uploaded file (drag-and-drop or file picker)
app.post('/transcribe/upload', upload.single('file'), async (req, res) => {
  const transcribeStart = Date.now();
  if (!req.file || !req.file.buffer) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  const key = process.env.GROQ_API_KEY;
  if (!key) {
    return res.status(503).json({ error: 'Transcription unavailable: GROQ_API_KEY not set' });
  }

  let userId = null;
  let userEmail = null;
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '') || req.body?.access_token;
  if (token) {
    const anon = getAnonClient();
    if (anon) {
      const { data: { user }, error } = await anon.auth.getUser(token);
      if (!error && user) {
        userId = user.id;
        userEmail = user.email ?? null;
      }
    }
  }

  let isFree = false;
  if (userId) {
    const supabase = getServiceClient();
    if (supabase) {
      const { data: profile } = await supabase.from('profiles').select('plan').eq('id', userId).single();
      isFree = profile?.plan !== 'pro';
    } else {
      isFree = true;
    }
    if (isFree) {
      const startOfTodayUtc = new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z';
      const supabaseForCount = getServiceClient();
      if (supabaseForCount) {
        const { count, error: countErr } = await supabaseForCount
          .from('transcription_jobs')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', userId)
          .gte('created_at', startOfTodayUtc);
        if (!countErr && count != null && count >= 3) {
          return res.status(403).json({
            error: 'Free limit: 3 transcriptions per day. Upgrade to Pro for more.',
          });
        }
      }
    }
  }

  const ext = path.extname(req.file.originalname || '') || '.bin';
  const tempPath = path.join(os.tmpdir(), `upload-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  try {
    fs.writeFileSync(tempPath, req.file.buffer);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to write temp file' });
  }

  const ffmpeg = spawn(
    ffmpegPath,
    ['-hide_banner', '-loglevel', 'error', '-i', tempPath, '-ac', '1', '-ar', '16000', '-f', 'wav', 'pipe:1'],
    { stdio: ['ignore', 'pipe', 'pipe'], shell: false }
  );
  const chunks = [];
  ffmpeg.stdout.on('data', (chunk) => chunks.push(chunk));
  ffmpeg.stderr.on('data', (d) => process.stderr.write(d));
  try {
    await new Promise((resolve, reject) => {
      ffmpeg.on('error', reject);
      ffmpeg.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg failed: ${code}`))));
    });
  } finally {
    try { fs.unlinkSync(tempPath); } catch (_) {}
  }

  const audioBuffer = Buffer.concat(chunks);
  if (audioBuffer.length === 0) {
    return res.status(502).json({ error: 'Could not convert file to audio' });
  }

  if (userId && isFree) {
    const duration_sec = getWavDurationSec(audioBuffer);
    if (duration_sec > 1800) {
      return res.status(403).json({
        error: 'Free limit: max 30 minutes per file. Upgrade to Pro for longer audio.',
      });
    }
  }

  try {
    let text = '';
    let segments = [];
    if (process.env.ELEVENLABS_API_KEY) {
      try {
        const sttResult = await transcribeWithDiarization(audioBuffer, 'audio.wav');
        text = sttResult.text || '';
        if (sttResult.words?.length > 0) {
          segments = wordsWithSpeakersToSegments(sttResult.words);
        }
        if (segments.length === 0 && text) {
          const { words } = await forceAlign(audioBuffer, text, 'audio.wav');
          if (words.length > 0) segments = wordsToSegments(words);
        }
      } catch (elErr) {
        console.error('ElevenLabs STT failed:', elErr.message);
        const whisperResult = await transcribe(audioBuffer, 'audio.wav', undefined, { verbose: true });
        text = whisperResult.text || '';
        segments = whisperResult.segments || [];
      }
    } else {
      const whisperResult = await transcribe(audioBuffer, 'audio.wav', undefined, { verbose: true });
      text = whisperResult.text || '';
      segments = whisperResult.segments || [];
    }
    const completedAt = new Date().toISOString();
    const duration_sec = getWavDurationSec(audioBuffer);
    const processing_sec = Math.round((Date.now() - transcribeStart) / 1000);

    res.json({
      text: text || '',
      segments,
      audioBase64: audioBuffer.toString('base64'),
      audioContentType: 'audio/wav',
    });

    const supabase = getServiceClient();
    const segmentsToSave = segments;
    const audioBufferToSave = audioBuffer;
    if (supabase) {
      (async () => {
        try {
          const { data: row, error: insertErr } = await supabase.from('transcription_jobs').insert({
            user_id: userId,
            user_email: userEmail,
            status: 'completed',
            source_type: 'upload',
            source_url: null,
            source_platform: null,
            original_filename: req.file.originalname || null,
            progress: 100,
            step: 'completed',
            duration_sec: duration_sec || null,
            processing_sec,
            transcript_text: text || null,
            segments: segmentsToSave?.length ? segmentsToSave : null,
            completed_at: completedAt,
          }).select('id').single();
          if (userId && !insertErr) {
            await supabase.rpc('increment_profile_jobs_created_total', { p_user_id: userId });
          }
          // Upload audio so history can play/seek. Bucket "transcription-audio" (public) required.
          if (row?.id && audioBufferToSave?.length && process.env.SUPABASE_URL) {
            try {
              const { error: uploadErr } = await supabase.storage.from('transcription-audio').upload(row.id + '.wav', audioBufferToSave, { contentType: 'audio/wav', upsert: true });
              if (!uploadErr) {
                const publicUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/transcription-audio/${row.id}.wav`;
                await supabase.from('transcription_jobs').update({ audio_url: publicUrl }).eq('id', row.id);
              }
            } catch (uploadErr) {
              console.error('Audio upload to storage failed:', uploadErr?.message || uploadErr);
            }
          }
        } catch (dbErr) {
          console.error('Failed to save transcription job:', dbErr);
        }
      })();
    }
  } catch (err) {
    console.error('Transcription error:', err);
    res.status(502).json({ error: err.message || 'Transcription failed' });
  }
});

app.get('/api/config', (req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
  });
});

app.post('/api/support', (req, res) => {
  const name = req.body && typeof req.body.name === 'string' ? req.body.name.trim() : '';
  const email = req.body && typeof req.body.email === 'string' ? req.body.email.trim() : '';
  const message = req.body && typeof req.body.message === 'string' ? req.body.message.trim() : '';
  if (!name || !email || !message) {
    return res.status(400).json({ error: 'Name, email, and message are required' });
  }
  // TODO: store in DB or send email; for now just acknowledge
  res.status(201).json({ message: 'Thank you. We\'ll get back to you soon.' });
});

// Resolve user from Bearer token; returns { userId, userEmail } or null
async function getUserFromToken(req) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '') || req.body?.access_token;
  if (!token) return null;
  const anon = getAnonClient();
  if (!anon) return null;
  const { data: { user }, error } = await anon.auth.getUser(token);
  if (error || !user) return null;
  return { userId: user.id, userEmail: user.email ?? null };
}

// Stripe Checkout: create subscription (monthly or annual), redirect to Stripe Checkout
app.post('/api/billing/checkout', async (req, res) => {
  const user = await getUserFromToken(req);
  if (!user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  const stripeSecret = process.env.STRIPE_SECRET_KEY;
  const priceMonthly = process.env.STRIPE_PRICE_ID_MONTHLY;
  const priceAnnual = process.env.STRIPE_PRICE_ID_ANNUAL;
  if (!stripeSecret || !priceMonthly || !priceAnnual) {
    return res.status(503).json({ error: 'Billing not configured' });
  }
  const interval = req.body && (req.body.interval === 'month' || req.body.interval === 'year') ? req.body.interval : 'year';
  const priceId = interval === 'month' ? priceMonthly : priceAnnual;
  const supabase = getServiceClient();
  if (!supabase) {
    return res.status(503).json({ error: 'Server configuration error' });
  }
  const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host') || 'localhost:3000'}`;
  try {
    const stripe = new Stripe(stripeSecret);
    let { data: billing } = await supabase.from('billing_customers').select('stripe_customer_id').eq('user_id', user.userId).single();
    if (!billing?.stripe_customer_id) {
      const customer = await stripe.customers.create({ email: user.userEmail || undefined });
      await supabase.from('billing_customers').upsert({
        user_id: user.userId,
        stripe_customer_id: customer.id,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
      billing = { stripe_customer_id: customer.id };
    }
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: billing.stripe_customer_id,
      client_reference_id: user.userId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${baseUrl}/account?checkout=success`,
      cancel_url: `${baseUrl}/upgrade`,
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error('Checkout error:', err);
    res.status(500).json({ error: err.message || 'Could not start checkout' });
  }
});

// Stripe Billing Portal: manage subscription (redirects to Stripe)
app.post('/api/billing/portal', async (req, res) => {
  const user = await getUserFromToken(req);
  if (!user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  const stripeSecret = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecret) {
    return res.status(503).json({ error: 'Billing not configured' });
  }
  const supabase = getServiceClient();
  if (!supabase) {
    return res.status(503).json({ error: 'Server configuration error' });
  }
  try {
    const stripe = new Stripe(stripeSecret);
    let { data: billing } = await supabase.from('billing_customers').select('stripe_customer_id').eq('user_id', user.userId).single();
    if (!billing?.stripe_customer_id) {
      const customer = await stripe.customers.create({ email: user.userEmail || undefined });
      await supabase.from('billing_customers').upsert({
        user_id: user.userId,
        stripe_customer_id: customer.id,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
      billing = { stripe_customer_id: customer.id };
    }
    const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host') || 'localhost:3000'}`;
    const session = await stripe.billingPortal.sessions.create({
      customer: billing.stripe_customer_id,
      return_url: `${baseUrl}/account`,
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error('Billing portal error:', err);
    res.status(500).json({ error: err.message || 'Could not open billing portal' });
  }
});

// Delete account (auth user + cascade removes profile/billing_customers)
app.post('/api/account/delete', async (req, res) => {
  const user = await getUserFromToken(req);
  if (!user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  const supabase = getServiceClient();
  if (!supabase) {
    return res.status(503).json({ error: 'Server configuration error' });
  }
  try {
    const { error } = await supabase.auth.admin.deleteUser(user.userId);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete account error:', err);
    res.status(500).json({ error: err.message || 'Could not delete account' });
  }
});

// Today's transcript count and daily limit (for "X/3" indicator when logged in)
app.get('/api/transcribe/usage', async (req, res) => {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) {
    return res.json({ used: 0, limit: null });
  }
  const anon = getAnonClient();
  if (!anon) return res.json({ used: 0, limit: null });
  const { data: { user }, error } = await anon.auth.getUser(token);
  if (error || !user) return res.json({ used: 0, limit: null });
  const userId = user.id;
  const supabase = getServiceClient();
  if (!supabase) return res.json({ used: 0, limit: null });
  const startOfToday = new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z';
  const { data: profile } = await supabase.from('profiles').select('plan, daily_job_limit').eq('id', userId).single();
  const limit = profile?.plan === 'pro' ? null : (profile?.daily_job_limit ?? 3);
  const { count, error: countErr } = await supabase
    .from('transcription_jobs')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', startOfToday);
  const used = countErr ? 0 : (count ?? 0);
  res.json({ used, limit });
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});
app.get('/signup', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'signup.html'));
});
app.get('/account', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'account.html'));
});
app.get('/upgrade', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'upgrade.html'));
});
app.get('/reset-password', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'reset-password.html'));
});
app.get('/support', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'support.html'));
});
app.get('/privacy-policy', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'privacy-policy.html'));
});
app.get('/terms-and-conditions', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'terms-and-conditions.html'));
});
app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'app.html'));
});
app.get('/test', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'test.html'));
});
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server at http://localhost:${PORT}`);
});
