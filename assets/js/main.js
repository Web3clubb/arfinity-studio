/* ARFINITY Studio: front-end behavior. Vanilla JS, no dependencies, no secrets.
   1. Journey: maps scroll position to --p on the sticky stage (one rAF per frame, no scroll hijacking).
   2. Header state, reveal-on-scroll.
   3. Lead form: client validation, submission, duplicate-proof states, honest errors. */
(() => {
  'use strict';

  const ENDPOINT = '/api/submit-lead';
  const IS_LOCAL = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /* ── 1. Journey ───────────────────────────────────────────────────────── */
  const journey = $('#worlds');
  const stage = $('#stage');
  const header = $('.site-header');
  const progressItems = $$('.progress li');
  let ticking = false;
  let activeStep = -1;

  function setupJourney() {
    const sticky = !reduceMotion.matches;
    journey.classList.toggle('is-sticky', sticky);
    if (!sticky) {
      stage.style.removeProperty('--p');
      activeStep = -1;
    }
    scheduleUpdate();
  }

  function updateJourney() {
    ticking = false;
    header.classList.toggle('is-scrolled', window.scrollY > 40);
    if (!journey.classList.contains('is-sticky')) return;

    const total = journey.offsetHeight - window.innerHeight;
    const top = journey.getBoundingClientRect().top;
    const p = Math.min(1, Math.max(0, -top / total));
    stage.style.setProperty('--p', p.toFixed(4));

    const step = p < 0.3 ? 0 : p < 0.58 ? 1 : p < 0.86 ? 2 : 3;
    if (step !== activeStep) {
      activeStep = step;
      progressItems.forEach((li, i) => li.classList.toggle('is-on', i === step));
    }
  }

  function scheduleUpdate() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(updateJourney);
  }

  window.addEventListener('scroll', scheduleUpdate, { passive: true });
  window.addEventListener('resize', scheduleUpdate, { passive: true });
  if (reduceMotion.addEventListener) reduceMotion.addEventListener('change', setupJourney);
  setupJourney();

  /* ── 2. Reveal on scroll ──────────────────────────────────────────────── */
  const revealEls = $$('.reveal');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('in');
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -6% 0px' },
    );
    revealEls.forEach((el) => io.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add('in'));
  }

  /* ── 3. Lead form ─────────────────────────────────────────────────────── */
  const form = $('#lead-form');
  if (!form) return;

  const formPanel = $('#form-panel');
  const confirmPanel = $('#confirm');
  const submitBtn = $('#btn-submit');
  const formError = $('#form-error');
  const devNotice = $('#dev-notice');
  const startedInput = $('#started_at');
  const campaignField = $('#campaign_description');
  const campaignCount = $('#count-campaign');

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const startedAt = Date.now();
  let submitting = false;
  let submitted = false;

  startedInput.value = String(startedAt);

  function normalizePhone(raw) {
    let s = String(raw || '').replace(/[\s\-().]/g, '');
    if (s.startsWith('00')) s = `+${s.slice(2)}`;
    return /^\+[1-9]\d{6,14}$/.test(s) ? s : null;
  }

  function looksLikeSite(raw) {
    if (raw.startsWith('@')) return /^@[A-Za-z0-9._]{1,30}$/.test(raw);
    try {
      const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
      return ['http:', 'https:'].includes(url.protocol) && url.hostname.includes('.');
    } catch {
      return false;
    }
  }

  function collect() {
    const f = form.elements;
    const world = form.querySelector('input[name="selected_world"]:checked');
    return {
      brand_name: f.brand_name.value.trim(),
      website_url: f.website_url.value.trim(),
      category: f.category.value,
      contact_name: f.contact_name.value.trim(),
      email: f.email.value.trim(),
      whatsapp: f.whatsapp.value.trim(),
      selected_world: world ? world.value : '',
      campaign_description: f.campaign_description.value.trim(),
      request_consent: f.request_consent.checked,
      marketing_consent: f.marketing_consent.checked,
      hp_company_fax: f.hp_company_fax.value,
    };
  }

  function validate(d) {
    const errors = {};
    if (d.brand_name.length < 2) errors.brand_name = 'Please enter your brand or business name.';
    if (!d.website_url) errors.website_url = 'Enter a website (yourbrand.com) or Instagram handle (@yourbrand).';
    else if (!looksLikeSite(d.website_url)) errors.website_url = 'That doesn’t look like a website or Instagram handle. Try yourbrand.com or @yourbrand.';
    if (!d.category) errors.category = 'Please choose a business category.';
    if (d.contact_name.length < 2) errors.contact_name = 'Please enter your name.';
    if (!EMAIL_RE.test(d.email)) errors.email = 'Please enter a valid business email.';
    if (!normalizePhone(d.whatsapp)) errors.whatsapp = 'Include your country code, for example +44 7700 900123.';
    if (!d.selected_world) errors.selected_world = 'Choose the world that interests you most.';
    if (!d.request_consent) errors.request_consent = 'Please agree so we can respond to your request.';
    return errors;
  }

  function fieldContainer(key) {
    return $(`[data-field="${key}"]`, form);
  }

  function showFieldError(key, message) {
    const errEl = document.getElementById(`err-${key}`);
    if (errEl) {
      errEl.textContent = message;
      errEl.hidden = false;
    }
    const container = fieldContainer(key);
    if (!container) return;
    const input = container.querySelector('input:not([type="radio"]), select, textarea');
    if (input) input.setAttribute('aria-invalid', 'true');
    if (key === 'selected_world') container.setAttribute('aria-invalid', 'true');
  }

  function clearFieldError(key) {
    const errEl = document.getElementById(`err-${key}`);
    if (errEl) {
      errEl.textContent = '';
      errEl.hidden = true;
    }
    const container = fieldContainer(key);
    if (!container) return;
    container.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
  }

  function clearAllErrors() {
    $$('.err', form).forEach((el) => {
      el.textContent = '';
      el.hidden = true;
    });
    $$('[aria-invalid]', form).forEach((el) => el.removeAttribute('aria-invalid'));
    formError.hidden = true;
    formError.textContent = '';
  }

  function focusFirstInvalid(keys) {
    const first = keys[0];
    const container = fieldContainer(first);
    if (!container) return;
    const target = container.querySelector('input:not([type="hidden"]), select, textarea');
    if (target) target.focus();
  }

  function showFormError(message) {
    formError.textContent = message;
    formError.hidden = false;
    formError.focus?.();
  }

  function setBusy(busy) {
    submitting = busy;
    submitBtn.disabled = busy;
    submitBtn.setAttribute('aria-busy', String(busy));
  }

  function showConfirmation() {
    submitted = true;
    formPanel.hidden = true;
    devNotice.hidden = true;
    confirmPanel.hidden = false;
    confirmPanel.focus();
  }

  function showDevNotice(message) {
    if (!IS_LOCAL) return;
    devNotice.textContent = `Dev setup: ${message} The form will not pretend to save a lead until credentials are configured.`;
    devNotice.hidden = false;
  }

  async function postLead(payload) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
        credentials: 'same-origin',
      });
      let body = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      return { status: res.status, body };
    } finally {
      clearTimeout(timer);
    }
  }

  // Server field keys map 1:1 to the form's data-field names.
  function applyServerErrors(errors) {
    const keys = Object.keys(errors);
    keys.forEach((key) => {
      if (key === 'form') showFormError(errors[key]);
      else showFieldError(key, errors[key]);
    });
    const firstField = keys.find((k) => k !== 'form');
    if (firstField) focusFirstInvalid([firstField]);
    else if (keys.includes('form')) formError.focus?.();
  }

  async function onSubmit(event) {
    event.preventDefault();
    if (submitting || submitted) return; // duplicate-submit guard

    clearAllErrors();
    const data = collect();
    const clientErrors = validate(data);
    const clientKeys = Object.keys(clientErrors);
    if (clientKeys.length) {
      clientKeys.forEach((key) => showFieldError(key, clientErrors[key]));
      focusFirstInvalid(clientKeys);
      return;
    }

    setBusy(true);
    try {
      const { status, body } = await postLead({ ...data, started_at: startedAt });

      if (status === 200 && body && body.ok === true) {
        showConfirmation();
        return;
      }
      if (status === 400 && body && body.errors) {
        applyServerErrors(body.errors);
        return;
      }
      if (status === 503 && body && body.code === 'not_configured') {
        showDevNotice('Supabase is not configured.');
        showFormError(body.message || 'We could not send your request. Please email support@arfinity.studio.');
        return;
      }
      if (status === 429) {
        showFormError(body?.message || 'Too many attempts. Please wait a few minutes and try again.');
        return;
      }
      showFormError(
        (body && body.message) ||
          'Something went wrong and your brief was not confirmed. Please try again, or email support@arfinity.studio.',
      );
    } catch {
      showFormError(
        'We could not reach the server. Check your connection and try again. If the problem continues, email support@arfinity.studio.',
      );
    } finally {
      setBusy(false);
    }
  }

  // Keep the UI state in sync with the choice and clear errors as the visitor fixes them.
  $$('input[name="selected_world"]', form).forEach((radio) => {
    radio.addEventListener('change', () => {
      $$('.opt', form).forEach((opt) => opt.classList.toggle('is-checked', opt.contains(radio) && radio.checked));
      clearFieldError('selected_world');
    });
  });

  form.addEventListener('input', (event) => {
    const name = event.target.name;
    if (!name || name === 'hp_company_fax') return;
    clearFieldError(name);
  });
  form.addEventListener('change', (event) => {
    if (event.target.name === 'request_consent') clearFieldError('request_consent');
    if (event.target.name === 'category') clearFieldError('category');
  });

  if (campaignField && campaignCount) {
    const updateCount = () => {
      campaignCount.textContent = `${campaignField.value.length} / ${campaignField.maxLength}`;
    };
    campaignField.addEventListener('input', updateCount);
    updateCount();
  }

  form.addEventListener('submit', onSubmit);
})();
