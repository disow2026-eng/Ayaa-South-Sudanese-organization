/* ============================================================
   AYAA South Sudanese Community Organization — Main JS
   Vanilla JS only. No frameworks.
   ============================================================ */

'use strict';

/* ---- Navbar: scroll shadow + active link ---- */
(function initNavbar() {
  const navbar = document.querySelector('.navbar');
  const hamburger = document.querySelector('.navbar__hamburger');
  const nav = document.querySelector('.navbar__nav');
  const ctaWrap = document.querySelector('.navbar__cta');

  if (!navbar) return;

  // Scroll shadow
  const onScroll = () => {
    navbar.classList.toggle('scrolled', window.scrollY > 20);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // Mobile hamburger
  if (hamburger && nav) {
    const closeMenu = () => {
      hamburger.classList.remove('open');
      hamburger.setAttribute('aria-expanded', 'false');
      nav.classList.remove('open');
      if (ctaWrap) ctaWrap.classList.remove('open');
      document.body.style.overflow = '';
    };

    hamburger.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = hamburger.classList.toggle('open');
      hamburger.setAttribute('aria-expanded', String(isOpen));
      nav.classList.toggle('open', isOpen);
      if (ctaWrap) ctaWrap.classList.toggle('open', isOpen);
      document.body.style.overflow = isOpen ? 'hidden' : '';
    });

    // Close menu on link click
    nav.querySelectorAll('.navbar__link').forEach(link => {
      link.addEventListener('click', closeMenu);
    });

    // Close menu when tapping outside
    document.addEventListener('click', (e) => {
      if (hamburger.classList.contains('open') &&
          !nav.contains(e.target) &&
          !hamburger.contains(e.target) &&
          !(ctaWrap && ctaWrap.contains(e.target))) {
        closeMenu();
      }
    });
  }

  // Active link based on current page
  const currentPath = window.location.pathname.split('/').pop() || 'index.html';
  navbar.querySelectorAll('.navbar__link').forEach(link => {
    const href = link.getAttribute('href');
    if (href === currentPath || (currentPath === '' && href === 'index.html')) {
      link.classList.add('active');
    }
  });
})();

/* ---- Scroll-triggered fade-up animations ---- */
(function initScrollAnimations() {
  const targets = document.querySelectorAll('.fade-up');
  if (!targets.length) return;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, {
    threshold: 0.1,
    rootMargin: '0px 0px -40px 0px'
  });

  targets.forEach(el => observer.observe(el));
})();

/* ---- Animated counters in stats bar ---- */
(function initCounters() {
  const counters = document.querySelectorAll('[data-count]');
  if (!counters.length) return;

  const animateCounter = (el) => {
    const target = parseFloat(el.dataset.count);
    const suffix = el.dataset.suffix || '';
    const prefix = el.dataset.prefix || '';
    const duration = 1800;
    const startTime = performance.now();

    const step = (now) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(eased * target);
      el.textContent = prefix + current.toLocaleString() + suffix;
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        animateCounter(entry.target);
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.5 });

  counters.forEach(el => observer.observe(el));
})();

/* ---- Donate page: tier selection ---- */
(function initDonateTiers() {
  const tiers = document.querySelectorAll('.donate-tier');
  if (!tiers.length) return;

  tiers.forEach(tier => {
    tier.addEventListener('click', () => {
      tiers.forEach(t => t.classList.remove('donate-tier--selected'));
      tier.classList.add('donate-tier--selected');

      // Optionally populate an amount input
      const amountInput = document.getElementById('donation-amount');
      if (amountInput) {
        const raw = tier.querySelector('.donate-tier__amount')?.textContent.replace(/[^0-9]/g, '');
        if (raw) amountInput.value = raw;
      }
    });
  });
})();

/* ---- Contact form: mailto handler ---- */
(function initContactForm() {
  const form = document.getElementById('contact-form');
  if (!form) return;

  form.addEventListener('submit', (e) => {
    e.preventDefault();

    const name    = form.querySelector('#name')?.value.trim() || '';
    const email   = form.querySelector('#email')?.value.trim() || '';
    const subject = form.querySelector('#subject')?.value.trim() || 'Message from AYAA Website';
    const message = form.querySelector('#message')?.value.trim() || '';

    const body = encodeURIComponent(
      `Name: ${name}\nEmail: ${email}\n\nMessage:\n${message}`
    );

    const mailtoLink = `mailto:simonORealtor@gmail.com?subject=${encodeURIComponent(subject)}&body=${body}`;
    window.location.href = mailtoLink;

    // Show success message
    showFormSuccess(form);
  });
})();

function showFormSuccess(form) {
  const existing = form.querySelector('.form-success');
  if (existing) return;

  const msg = document.createElement('div');
  msg.className = 'form-success';
  msg.style.cssText = `
    margin-top: 1.5rem;
    padding: 1.25rem 1.5rem;
    background: #E8F5E9;
    border: 1px solid rgba(7,137,48,0.3);
    border-radius: 8px;
    color: #055A20;
    font-weight: 600;
    font-size: 0.95rem;
    display: flex;
    align-items: center;
    gap: 0.75rem;
  `;
  msg.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#055A20" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><polyline points="20 6 9 17 4 12"/></svg> Thank you! Your message is ready to send. Your email client should open momentarily.`;
  form.appendChild(msg);

  setTimeout(() => msg.remove(), 8000);
}

/* ---- Smooth scroll for anchor links ---- */
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', (e) => {
    const target = document.querySelector(anchor.getAttribute('href'));
    if (target) {
      e.preventDefault();
      const offset = 80; // navbar height
      const top = target.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({ top, behavior: 'smooth' });
    }
  });
});

/* ---- Add current year to copyright ---- */
(function setCopyrightYear() {
  const els = document.querySelectorAll('.js-year');
  const year = new Date().getFullYear();
  els.forEach(el => (el.textContent = year));
})();

/* ---- Remove Netlify badge ---- */
(function removeNetlifyBadge() {
  const SELECTORS = [
    '[data-netlify-identity-button]',
    '#netlify-badge',
    '.netlify-badge',
    'a[href*="netlify.com"]',
    'img[src*="netlify"]',
    'img[alt*="Netlify"]',
    'img[alt*="netlify"]',
    '[class*="netlify"]',
    '[id*="netlify"]',
  ].join(', ');

  const remove = () => {
    document.querySelectorAll(SELECTORS).forEach(el => {
      // Walk up to remove the whole badge wrapper, not just the img/link
      let target = el;
      while (target.parentElement && target.parentElement !== document.body &&
             target.parentElement.children.length === 1) {
        target = target.parentElement;
      }
      target.remove();
    });
  };

  // Run immediately, on load, and watch for dynamic injection
  remove();
  window.addEventListener('load', remove);
  const observer = new MutationObserver(remove);
  const watchBody = () => {
    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
    }
  };
  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', watchBody)
    : watchBody();
  // Belt-and-suspenders: keep checking for 5 seconds after load
  const interval = setInterval(remove, 300);
  setTimeout(() => clearInterval(interval), 5000);
})();
