/**
 * Scribbby "My transcripts" component: fixed bottom-left panel with transcript selector.
 * Shows when user is logged in; dispatches 'scribbby-transcript-selected' with { job } on select.
 * Listens for 'transcripts-updated' to refresh the list.
 */
(function () {
  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  class ScribbbyMyTranscripts extends HTMLElement {
    static get observedAttributes() { return []; }

    constructor() {
      super();
      this._jobs = [];
      this._supabase = null;
      this._mounted = false;
      this._onTranscriptsUpdated = () => this._refresh();
    }

    connectedCallback() {
      if (this._mounted) return;
      this._mounted = true;
      this.classList.add('scribbby-my-transcripts');
      this.style.display = 'none';
      this.innerHTML = `
        <div class="scribbby-my-transcripts-panel">
          <h3 class="scribbby-my-transcripts-title">My transcripts</h3>
          <select id="myTranscriptsSelect" class="scribbby-my-transcripts-select" aria-label="Select a transcript to view">
            <option value="">Select a transcript…</option>
          </select>
        </div>
      `;
      this._select = this.querySelector('#myTranscriptsSelect');
      this._select.addEventListener('change', () => this._onSelect());
      window.addEventListener('transcripts-updated', this._onTranscriptsUpdated);
      this._initAuth();
    }

    disconnectedCallback() {
      window.removeEventListener('transcripts-updated', this._onTranscriptsUpdated);
    }

    async _initAuth() {
      let config;
      try {
        const res = await fetch('/api/config');
        config = await res.json();
      } catch (e) {
        return;
      }
      const { supabaseUrl, supabaseAnonKey } = config;
      if (!supabaseUrl || !supabaseAnonKey) return;
      const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
      this._supabase = createClient(supabaseUrl, supabaseAnonKey);
      const { data: { session } } = await this._supabase.auth.getSession();
      this._setLoggedIn(!!session?.user);
      this._supabase.auth.onAuthStateChange((_event, session) => {
        this._setLoggedIn(!!session?.user);
      });
    }

    _setLoggedIn(loggedIn) {
      this.style.display = loggedIn ? 'block' : 'none';
      if (!loggedIn) {
        this._jobs = [];
        this._select.innerHTML = '<option value="">Select a transcript…</option>';
        this._select.value = '';
        return;
      }
      this._loadTranscripts();
    }

    async _loadTranscripts() {
      if (!this._supabase) return;
      const { data: jobs, error } = await this._supabase
        .from('transcription_jobs')
        .select('id, source_url, source_platform, duration_sec, processing_sec, created_at, transcript_text, segments, audio_url')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) {
        this._select.innerHTML = '<option value="">Could not load transcripts.</option>';
        return;
      }
      this._jobs = jobs || [];
      this._select.innerHTML = '<option value="">Select a transcript…</option>' + this._jobs.map((job) => {
        const date = job.created_at ? new Date(job.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
        const platform = job.source_platform || '—';
        const dur = job.duration_sec != null ? `${job.duration_sec}s` : '';
        const label = [date, platform, dur].filter(Boolean).join(' · ');
        return `<option value="${escapeHtml(job.id)}">${escapeHtml(label)}</option>`;
      }).join('');
      this._select.value = '';
    }

    _onSelect() {
      const id = this._select.value;
      if (!id) return;
      const job = this._jobs.find((j) => j.id === id);
      if (!job) return;
      this.dispatchEvent(new CustomEvent('scribbby-transcript-selected', { bubbles: true, detail: { job } }));
    }

    _refresh() {
      if (this.style.display !== 'none') this._loadTranscripts();
    }
  }

  customElements.define('scribbby-my-transcripts', ScribbbyMyTranscripts);
})();
