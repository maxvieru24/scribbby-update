/**
 * Scribbby URL-or-upload component: input wrap (URL + Transcribe button) + toggle link + drop area.
 * Reusable; drop <scribbby-url-upload> anywhere and link url-upload.css.
 * Inner elements keep ids: slot, url, btnTranscribe, toggleLink, uploadZone, fileInput.
 */
const LINK_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none">
  <path fill-rule="evenodd" clip-rule="evenodd" d="M10.0371 7.26883C10.2528 7.67542 10.098 8.17984 9.6914 8.3955C9.42776 8.53533 9.17967 8.71662 8.95667 8.94041C7.77329 10.1281 7.75344 12.1385 8.94451 13.3296L11.3611 15.7463C12.563 16.9481 14.5521 16.9322 15.7493 15.7352C16.9583 14.5262 16.9583 12.5671 15.7493 11.3581L14.9022 10.511C14.5768 10.1856 14.5768 9.65793 14.9022 9.33248C15.2277 9.00705 15.7552 9.00706 16.0807 9.3325L16.9278 10.1796C18.7877 12.0395 18.7877 15.0538 16.9278 16.9136C15.0883 18.753 12.0268 18.7689 10.1827 16.9248L7.766 14.5081C5.90612 12.6482 5.90612 9.63393 7.766 7.77405C8.10431 7.43617 8.48772 7.14733 8.91045 6.92312C9.31704 6.70746 9.82146 6.86224 10.0371 7.26883Z" fill="#182E52"/>
  <path fill-rule="evenodd" clip-rule="evenodd" d="M9.81974 3.07515L12.2364 5.49182C14.0796 7.33497 14.0655 10.397 12.2264 12.236C11.884 12.5795 11.5008 12.86 11.092 13.0769C10.6854 13.2925 10.181 13.1378 9.96533 12.7311C9.74967 12.3245 9.90445 11.8201 10.311 11.6044C10.5821 11.4606 10.8301 11.2756 11.0468 11.0585C12.2439 9.86136 12.2596 7.87209 11.0579 6.67033L8.64123 4.25366C7.44076 3.05318 5.44853 3.06591 4.25311 4.26477C3.04411 5.47377 3.04411 7.43281 4.25311 8.64182L5.10022 9.48893C5.42565 9.81436 5.42565 10.342 5.10021 10.6674C4.77477 10.9929 4.24713 10.9929 3.92169 10.6674L3.07459 9.82033C1.21488 7.96061 1.21472 4.94667 3.07411 3.08675C4.91109 1.24446 7.97729 1.2327 9.81974 3.07515Z" fill="#182E52" fill-opacity="0.4"/>
</svg>`;

class ScribbbyUrlUpload extends HTMLElement {
  static get observedAttributes() { return []; }

  connectedCallback() {
    if (this.querySelector('#slot')) return; // already rendered
    this.classList.add('scribbby-url-upload');
    this.innerHTML = `
      <div id="slot" class="slot-url">
        <div class="url-wrap">
          <div class="url-input-group">
            <span class="url-input-icon" aria-hidden="true">${LINK_ICON_SVG}</span>
            <input type="url" id="url" name="url" placeholder="Paste a link to transcribe..." autocomplete="off">
            <button type="button" id="btnTranscribe">Transcribe</button>
          </div>
        </div>
        <div class="upload-zone" id="uploadZone" role="button" tabindex="0" aria-label="Upload file to transcribe">
          <input type="file" id="fileInput" accept="audio/*,video/*,.m4a,.mp3,.wav,.webm,.ogg,.flac,.mp4,.mov" aria-hidden="true">
          <p>Drop a file here or <strong>browse</strong> to upload and transcribe</p>
        </div>
      </div>
      <p class="toggle-wrap">
        <a href="#" id="toggleLink">or upload a file</a>
      </p>
    `;
    const slot = this.querySelector('#slot');
    const toggleLink = this.querySelector('#toggleLink');
    toggleLink.addEventListener('click', (e) => {
      e.preventDefault();
      if (slot.classList.contains('slot-url')) {
        slot.classList.remove('slot-url');
        slot.classList.add('slot-file');
        toggleLink.textContent = 'or paste a link';
      } else {
        slot.classList.remove('slot-file');
        slot.classList.add('slot-url');
        toggleLink.textContent = 'or upload a file';
      }
    });
  }
}

customElements.define('scribbby-url-upload', ScribbbyUrlUpload);
