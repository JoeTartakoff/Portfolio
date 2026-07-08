const SECTION_ORDER = ["about", "skills", "projects", "hobbies", "contact"];

async function loadSections() {
  const main = document.getElementById("main");
  const htmls = await Promise.all(
    SECTION_ORDER.map((id) => fetch(`sections/${id}.html`, { cache: "no-store" }).then((r) => r.text()))
  );
  main.innerHTML = htmls.join("\n");
  initReveal();
  initNav();
  initSkillCarousel();
  initMiniCarousels();
}

function initReveal() {
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add("in");
          io.unobserve(e.target);
        }
      });
    },
    { threshold: 0.15, rootMargin: "0px 0px -8% 0px" }
  );
  document.querySelectorAll(".reveal:not(.in)").forEach((el) => io.observe(el));
}

function initNav() {
  const links = document.querySelectorAll(".topnav a[href^='#']");
  const slides = [...links].map((a) => document.querySelector(a.getAttribute("href")));
  const spyIO = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        const id = "#" + e.target.id;
        links.forEach((a) => a.classList.toggle("active", a.getAttribute("href") === id));
      });
    },
    { threshold: 0.6 }
  );
  slides.forEach((s) => s && spyIO.observe(s));
}

function initSkillCarousel() {
  const track = document.querySelector(".skill-track");
  if (!track) return;
  const cards = [...track.querySelectorAll(".skill-card")];
  const dots = [...document.querySelectorAll(".skill-dots button")];

  const setActive = (i) => {
    dots.forEach((d, di) => d.classList.toggle("active", di === i));
  };

  const currentIndex = () => {
    const maxScroll = track.scrollWidth - track.clientWidth;
    if (track.scrollLeft >= maxScroll - 1) return cards.length - 1;
    if (track.scrollLeft <= 0) return 0;
    let closest = 0;
    let min = Infinity;
    cards.forEach((c, i) => {
      const d = Math.abs(c.offsetLeft - track.scrollLeft);
      if (d < min) { min = d; closest = i; }
    });
    return closest;
  };

  const goTo = (i) => {
    const clamped = Math.max(0, Math.min(cards.length - 1, i));
    track.scrollTo({ left: cards[clamped].offsetLeft, behavior: "smooth" });
  };

  dots.forEach((d, i) => d.addEventListener("click", () => goTo(i)));

  let scrollTimer;
  track.addEventListener("scroll", () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => setActive(currentIndex()), 80);
  });

  setActive(0);
}

function initMiniCarousels() {
  document.querySelectorAll(".mini-carousel").forEach((el) => {
    const track = el.querySelector(".mini-track");
    const images = [...track.children];
    const prevBtn = el.querySelector(".mini-nav.prev");
    const nextBtn = el.querySelector(".mini-nav.next");
    let index = 0;

    const render = () => {
      track.style.transform = `translateX(-${index * 100}%)`;
    };

    const step = (dir, e) => {
      e.stopPropagation();
      index = (index + dir + images.length) % images.length;
      render();
    };

    prevBtn.addEventListener("click", (e) => step(-1, e));
    nextBtn.addEventListener("click", (e) => step(1, e));
  });
}

loadSections();
