// Client mount for the OnboardingWizard component.
// Drives step transitions, persists the captured name + context into the
// existing [data-agent-name] / [data-agent-org] inputs so src/lib/agent.ts
// keeps working unchanged, and fires the first user message via the existing
// [data-agent-form] submit hook.

type StepNum = 1 | 2 | 3;

const STORAGE_KEY_ONBOARDED = 'agent-onboarded';
const STORAGE_KEY_NAME = 'agent-visitor-name';
const STORAGE_KEY_ORG = 'agent-visitor-org';

type Refs = {
  agentRoot: HTMLElement;
  wizard: HTMLElement;
  steps: Map<StepNum, HTMLElement>;
  stepCrumb: HTMLElement | null;
  nameField: HTMLInputElement | null;
  orgField: HTMLTextAreaElement | null;
  questionField: HTMLInputElement | null;
  agentNameInput: HTMLInputElement | null;
  agentOrgInput: HTMLInputElement | null;
  agentIntroCard: HTMLElement | null;
  agentForm: HTMLFormElement | null;
  agentInput: HTMLInputElement | null;
  editPill: HTMLElement | null;
};

export function mountOnboarding(agentRoot: HTMLElement): void {
  const wizard = agentRoot.querySelector<HTMLElement>('[data-onboarding]');
  if (!wizard) return;

  const stepEls = Array.from(
    wizard.querySelectorAll<HTMLElement>('[data-onboarding-step]')
  );
  const steps = new Map<StepNum, HTMLElement>();
  for (const el of stepEls) {
    const n = Number(el.getAttribute('data-onboarding-step')) as StepNum;
    if (n === 1 || n === 2 || n === 3) steps.set(n, el);
  }

  const refs: Refs = {
    agentRoot,
    wizard,
    steps,
    stepCrumb: wizard.querySelector<HTMLElement>('[data-onboarding-step-num]'),
    nameField: wizard.querySelector<HTMLInputElement>('[data-onboarding-field="name"]'),
    orgField: wizard.querySelector<HTMLTextAreaElement>('[data-onboarding-field="org"]'),
    questionField: wizard.querySelector<HTMLInputElement>('[data-onboarding-field="question"]'),
    agentNameInput: agentRoot.querySelector<HTMLInputElement>('[data-agent-name]'),
    agentOrgInput: agentRoot.querySelector<HTMLInputElement>('[data-agent-org]'),
    agentIntroCard: agentRoot.querySelector<HTMLElement>('[data-agent-intro]'),
    agentForm: agentRoot.querySelector<HTMLFormElement>('[data-agent-form]'),
    agentInput: agentRoot.querySelector<HTMLInputElement>('[data-agent-input]'),
    editPill: agentRoot.querySelector<HTMLElement>('[data-onboarding-edit]'),
  };

  // The intro card duplicates the inputs the wizard now collects. Hide it
  // visually but leave it in the DOM — src/lib/agent.ts still reads from
  // [data-agent-name] / [data-agent-org] as its source of truth.
  if (refs.agentIntroCard) {
    refs.agentIntroCard.style.display = 'none';
    refs.agentIntroCard.setAttribute('aria-hidden', 'true');
  }

  // Ensure the agent root can host the absolutely-positioned wizard.
  const computed = window.getComputedStyle(agentRoot);
  if (computed.position === 'static') {
    agentRoot.style.position = 'relative';
  }

  let current: StepNum = 1;
  let transitioning = false;

  function alreadyOnboarded(): boolean {
    try {
      if (localStorage.getItem(STORAGE_KEY_ONBOARDED) !== '1') return false;
      // Treat as onboarded only if storage has *something* — otherwise re-prompt.
      const name = localStorage.getItem(STORAGE_KEY_NAME) || '';
      const org = localStorage.getItem(STORAGE_KEY_ORG) || '';
      return Boolean(name || org);
    } catch {
      return false;
    }
  }

  // Pre-fill from storage so re-opens feel continuous.
  try {
    if (refs.nameField) refs.nameField.value = localStorage.getItem(STORAGE_KEY_NAME) || '';
    if (refs.orgField) refs.orgField.value = localStorage.getItem(STORAGE_KEY_ORG) || '';
  } catch {}

  function open(initial: StepNum = 1): void {
    refs.wizard.hidden = false;
    refs.wizard.setAttribute('data-onboarding-state', 'visible');
    // Reset all steps then activate the initial.
    for (const [, el] of refs.steps) {
      el.setAttribute('data-active', 'false');
      el.setAttribute('data-leaving', 'false');
      el.setAttribute('aria-hidden', 'true');
    }
    current = initial;
    const step = refs.steps.get(initial);
    if (step) {
      step.setAttribute('data-active', 'true');
      step.setAttribute('aria-hidden', 'false');
      focusFirstControl(step);
    }
    updateCrumb();
  }

  function close(): void {
    refs.wizard.setAttribute('data-onboarding-state', 'closing');
    // Brief exit animation, then hard-hide.
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const wait = reduced ? 40 : 200;
    window.setTimeout(() => {
      refs.wizard.setAttribute('data-onboarding-state', 'hidden');
      refs.wizard.hidden = true;
      // Hand focus back to the chat input for immediate typing.
      refs.agentInput?.focus({ preventScroll: true });
    }, wait);
  }

  function updateCrumb(): void {
    if (refs.stepCrumb) refs.stepCrumb.textContent = String(current);
    // Update the 3-dot step indicator.
    for (const dot of refs.wizard.querySelectorAll<HTMLElement>('[data-onboarding-dot]')) {
      const n = Number(dot.getAttribute('data-onboarding-dot'));
      dot.setAttribute('data-current', n === current ? 'true' : 'false');
      dot.setAttribute('data-done', n < current ? 'true' : 'false');
    }
  }

  function transition(to: StepNum): void {
    if (transitioning || to === current) return;
    const from = current;
    const fromEl = refs.steps.get(from);
    const toEl = refs.steps.get(to);
    if (!toEl) return;

    transitioning = true;
    if (fromEl) {
      fromEl.setAttribute('data-leaving', 'true');
      fromEl.setAttribute('data-active', 'false');
      fromEl.setAttribute('aria-hidden', 'true');
    }
    // Stagger so the leaving step's animation gets a frame.
    requestAnimationFrame(() => {
      toEl.setAttribute('data-active', 'true');
      toEl.setAttribute('aria-hidden', 'false');
      current = to;
      updateCrumb();
      focusFirstControl(toEl);
      // Release the lock after the duration of the longest animation.
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.setTimeout(() => {
        if (fromEl) fromEl.setAttribute('data-leaving', 'false');
        transitioning = false;
      }, reduced ? 60 : 260);
    });
  }

  function focusFirstControl(stepEl: HTMLElement): void {
    // Defer to next tick so animation start doesn't fight focus().
    window.setTimeout(() => {
      const target =
        stepEl.querySelector<HTMLElement>('input, textarea') ||
        stepEl.querySelector<HTMLElement>('button');
      target?.focus({ preventScroll: true });
    }, 30);
  }

  function commitNameOrg(): void {
    const name = (refs.nameField?.value || '').trim().slice(0, 80);
    const org = (refs.orgField?.value || '').trim().slice(0, 600);
    try {
      if (name) localStorage.setItem(STORAGE_KEY_NAME, name);
      if (org) localStorage.setItem(STORAGE_KEY_ORG, org);
    } catch {}
    // Mirror into the hidden intro-card inputs so src/lib/agent.ts sees them.
    if (refs.agentNameInput) {
      refs.agentNameInput.value = name;
      refs.agentNameInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (refs.agentOrgInput) {
      refs.agentOrgInput.value = org;
      refs.agentOrgInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  function finishAndFire(question: string): void {
    commitNameOrg();
    try { localStorage.setItem(STORAGE_KEY_ONBOARDED, '1'); } catch {}
    close();
    const q = question.trim();
    if (q && refs.agentInput && refs.agentForm) {
      refs.agentInput.value = q;
      // Slight delay so the close animation can begin first.
      window.setTimeout(() => {
        refs.agentForm?.requestSubmit?.();
        // Fallback for older browsers without requestSubmit.
        if (!refs.agentForm?.requestSubmit) {
          refs.agentForm?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
        }
      }, 120);
    }
  }

  function skip(): void {
    commitNameOrg();
    try { localStorage.setItem(STORAGE_KEY_ONBOARDED, '1'); } catch {}
    close();
  }

  // ---- Wire controls ------------------------------------------------------

  for (const btn of wizard.querySelectorAll<HTMLButtonElement>('[data-onboarding-next]')) {
    btn.addEventListener('click', () => {
      if (current === 1) {
        commitNameOrg();
        transition(2);
      } else if (current === 2) {
        commitNameOrg();
        transition(3);
      }
    });
  }

  for (const btn of wizard.querySelectorAll<HTMLButtonElement>('[data-onboarding-skip]')) {
    btn.addEventListener('click', () => skip());
  }

  const closeBtn = wizard.querySelector<HTMLButtonElement>('[data-onboarding-close]');
  closeBtn?.addEventListener('click', () => skip());

  const finishBtn = wizard.querySelector<HTMLButtonElement>('[data-onboarding-finish]');
  finishBtn?.addEventListener('click', () => {
    const q = refs.questionField?.value || '';
    finishAndFire(q);
  });

  // Quick-prompt buttons: clicking either fills the field (so the user can
  // edit) or, if held with a modifier, fires immediately. We keep it simple:
  // click = fill + highlight + focus the question input.
  for (const btn of wizard.querySelectorAll<HTMLButtonElement>('[data-onboarding-prompt]')) {
    btn.addEventListener('click', () => {
      const prompt = btn.getAttribute('data-onboarding-prompt') || '';
      if (!prompt) return;
      // Clear other selections.
      for (const other of wizard.querySelectorAll<HTMLButtonElement>('[data-onboarding-prompt]')) {
        other.setAttribute('data-selected', other === btn ? 'true' : 'false');
      }
      // Fire immediately — clicking a starter is a clear "ask this" intent.
      finishAndFire(prompt);
    });
  }

  // Keyboard: Enter advances; Shift+Enter inside a textarea = newline; Esc closes.
  // (Cmd/Ctrl+Enter also advances, mirrors chat-app convention.)
  wizard.addEventListener('keydown', (e) => {
    const k = e.key;
    if (k === 'Escape') {
      e.preventDefault();
      skip();
      return;
    }
    if (k !== 'Enter') return;
    const target = e.target as HTMLElement | null;
    // Shift+Enter inside a textarea inserts a newline — don't advance.
    if (target?.tagName === 'TEXTAREA' && e.shiftKey) return;
    e.preventDefault();
    if (current === 1) {
      commitNameOrg();
      transition(2);
    } else if (current === 2) {
      commitNameOrg();
      transition(3);
    } else if (current === 3) {
      const q = refs.questionField?.value || '';
      finishAndFire(q);
    }
  });

  // Edit-context pill in the chat chrome re-opens the wizard.
  refs.editPill?.addEventListener('click', () => open(1));

  // ---- First-visit decision ------------------------------------------------

  if (!alreadyOnboarded()) {
    // Defer slightly so the page paint isn't blocked by focus().
    window.setTimeout(() => open(1), 40);
  } else {
    refs.wizard.hidden = true;
    refs.wizard.setAttribute('data-onboarding-state', 'hidden');
  }
}

// Auto-mount when imported from VoiceAgent.astro.
const root = document.querySelector<HTMLElement>('[data-agent]');
if (root) mountOnboarding(root);
