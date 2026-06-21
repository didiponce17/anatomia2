/* ============================================================== */
/* Anatomía Estudio — app.js                                        */
/* Vanilla JS, no framework. Loads data.json and drives the UI.     */
/* ============================================================== */

(() => {
  "use strict";

  // ---------- state ----------
  const STORAGE_KEY = "anato-progress-v1";

  const state = {
    data: null,
    topicIndex: 0,
    mode: "study", // study | quiz | repaso | home
    quiz: {
      questions: [],
      index: 0,
      answered: false,
      score: 0,
      total: 0,
      finished: false,
      pareoSelections: []
    },
    repaso: {
      scope: "all",          // "all" | "topic"
      cards: [],             // full deck for this session (objects)
      queueKeys: [],          // remaining card keys (in order)
      currentIdx: 0,          // index into queueKeys
      revealed: false,
      mastered: [],           // keys marked as known
      toReview: [],           // keys marked as "repasar"
      finished: false
    },
    progress: loadProgress()
  };

  function loadProgress() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultProgress();
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return defaultProgress();
      return { ...defaultProgress(), ...parsed };
    } catch (e) {
      return defaultProgress();
    }
  }

  function defaultProgress() {
    return {
      answered: {}, // questionId -> { correct: bool, attempts: int }
      topicAnswered: {} // topicId -> { correct: n, total: n }
    };
  }

  function saveProgress() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.progress));
    } catch (e) {
      /* quota or private mode */
    }
  }

  function resetProgress() {
    state.progress = defaultProgress();
    saveProgress();
    renderTopicsList();
    renderGlobalProgress();
  }

  // ---------- DOM helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  function el(tag, attrs = {}, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "className") e.className = v;
      else if (k === "html") e.innerHTML = v;
      else if (k.startsWith("on") && typeof v === "function") {
        e.addEventListener(k.slice(2).toLowerCase(), v);
      } else if (v !== undefined && v !== null) {
        e.setAttribute(k, v);
      }
    }
    for (const c of children) {
      if (c === null || c === undefined) continue;
      e.append(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return e;
  }

  // ---------- shuffling helpers ----------
  function shuffle(array) {
    const a = array.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ---------- progress ----------
  function recordAnswer(question, isCorrect) {
    const prev = state.progress.answered[question.id];
    const attempts = (prev ? prev.attempts : 0) + 1;
    state.progress.answered[question.id] = {
      correct: isCorrect || (prev && prev.correct) || false,
      lastCorrect: isCorrect,
      attempts
    };
    saveProgress();
  }

  function topicStats(topic) {
    let correct = 0;
    let answered = 0;
    for (const q of topic.questions) {
      const a = state.progress.answered[q.id];
      if (a) {
        answered++;
        if (a.correct) correct++;
      }
    }
    return { correct, answered, total: topic.questions.length };
  }

  function globalStats() {
    let correct = 0;
    let answered = 0;
    let total = 0;
    for (const t of state.data.topics) {
      total += t.questions.length;
      for (const q of t.questions) {
        const a = state.progress.answered[q.id];
        if (a) {
          answered++;
          if (a.correct) correct++;
        }
      }
    }
    return { correct, answered, total };
  }

  function renderGlobalProgress() {
    if (!state.data) return;
    const s = globalStats();
    const pct = s.total ? Math.round((s.answered / s.total) * 100) : 0;
    const accPct = s.answered ? Math.round((s.correct / s.answered) * 100) : 0;
    $("#globalProgressBar").style.width = `${pct}%`;
    $("#globalProgressLabel").textContent =
      `${s.answered} / ${s.total} preguntas · ${accPct} % aciertos`;
  }

  // ---------- topics list ----------
  function renderTopicsList() {
    const list = $("#topicsList");
    list.innerHTML = "";
    state.data.topics.forEach((t, i) => {
      const stats = topicStats(t);
      const pct = stats.total ? Math.round((stats.answered / stats.total) * 100) : 0;
      const chipClass = t.system === "digestivo" ? "topic-system-chip dig" : "topic-system-chip";
      const item = el(
        "li",
        {
          className:
            "list-group-item d-flex justify-content-between align-items-center" +
            (i === state.topicIndex ? " active" : ""),
          role: "button",
          tabindex: "0",
          onclick: () => selectTopic(i, true),
          onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectTopic(i, true); }}
        },
        el("div", {},
          el("span", { className: chipClass }, t.system === "digestivo" ? "Dig" : "Resp"),
          el("span", {}, `${i + 1}. ${t.title}`)
        ),
        el("span", { className: "topic-row-progress", title: `${pct}% respondidas` },
          el("span", { style: `width:${pct}%;` })
        )
      );
      list.appendChild(item);
    });
  }

  function selectTopic(index, closeDrawer = false) {
    state.topicIndex = index;
    $("#appTopicTitle").textContent = state.data.topics[index].title;
    $("#appSubtitle").textContent = state.data.topics[index].system === "respiratorio"
      ? "Sistema Respiratorio"
      : "Sistema Digestivo";
    // From drawer: always show Study so the user sees the picked topic.
    // From in-app navigation: re-render the current mode.
    if (closeDrawer) {
      setMode("study");
    } else {
      if (state.mode === "study") renderStudyView();
      else if (state.mode === "quiz") startQuiz();
      else if (state.mode === "repaso") startRepaso();
    }
    renderTopicsList();
    if (closeDrawer) {
      const off = bootstrap.Offcanvas.getInstance($("#topicsDrawer"));
      if (off) off.hide();
    }
  }

  // ---------- mode switching ----------
  function setMode(mode) {
    state.mode = mode;
    for (const m of ["home", "study", "quiz", "repaso"]) {
      const view = $(`#${m}View`);
      if (view) view.classList.toggle("d-none", m !== mode);
    }
    $$(".bottom-nav-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.mode === mode);
    });
    if (mode === "study") renderStudyView();
    if (mode === "quiz") startQuiz();
    if (mode === "repaso") startRepaso();
  }

  // ---------- STUDY ----------
  function renderStudyView() {
    const t = state.data.topics[state.topicIndex];
    const v = $("#studyView");
    v.innerHTML = "";

    const card = el("article", { className: "topic-card" });
    card.appendChild(el("span", { className: "system-tag" },
      t.system === "respiratorio" ? "Sistema Respiratorio" : "Sistema Digestivo"
    ));
    card.appendChild(el("h2", {}, `${t.id}. ${t.title}`));

    card.appendChild(el("div", { className: "idea-central" }, `💡 ${t.idea_central}`));

    // 3 puntos clave
    card.appendChild(el("div", { className: "block-title" }, "3 puntos clave"));
    const kp = el("div", {});
    t.key_points.forEach((p) => kp.appendChild(el("div", { className: "key-point" }, p)));
    card.appendChild(kp);

    // Mnemonic
    if (t.mnemonic) {
      card.appendChild(el("div", { className: "block-title" }, "Ayuda de memoria"));
      card.appendChild(el("div", { className: "mnemonic-box" }, `🧠 ${t.mnemonic}`));
    }

    // Expandable: explanation
    const expandWrap1 = makeExpander("Ver explicación rápida", () => {
      const wrap = el("ul", { className: "bullet-list" });
      t.explanation.forEach((b) => wrap.appendChild(el("li", { html: linkifyBold(b) })));
      return wrap;
    });
    card.appendChild(expandWrap1);

    // Expandable: concepts
    if (t.concepts && t.concepts.length) {
      const expandWrap2 = makeExpander("Ver conceptos importantes", () => {
        const wrap = el("div", {});
        t.concepts.forEach((c) =>
          wrap.appendChild(
            el("div", { className: "concept-row" },
              el("span", { className: "term" }, c.term),
              el("span", { className: "def" }, c.definition)
            )
          )
        );
        return wrap;
      });
      card.appendChild(expandWrap2);
    }

    // Images (real renders from PDFs)
    if (Array.isArray(t.images) && t.images.length) {
      const gallery = el("div", { className: "image-gallery" });
      gallery.appendChild(el("div", { className: "image-gallery-title" }, "🖼️ Imágenes de la clase"));
      t.images.forEach((im) => {
        const figure = el("figure", { className: "image-figure" });
        const imgEl = el("img", {
          className: "topic-image",
          src: encodeURI(im.src),
          alt: im.caption || "Imagen anatómica",
          loading: "lazy",
          onclick: () => openImageViewer(encodeURI(im.src), im.caption || "")
        });
        figure.appendChild(imgEl);
        if (im.caption) {
          figure.appendChild(el("figcaption", { className: "image-caption" }, im.caption));
        }
        gallery.appendChild(figure);
      });
      card.appendChild(gallery);
    } else if (t.image_ref) {
      card.appendChild(el("div", { className: "image-ref" }, `🖼️ ${t.image_ref}`));
    }

    // Nav
    const navRow = el("div", { className: "nav-buttons-row" });
    navRow.appendChild(
      el("button",
        { className: "btn btn-outline-secondary", disabled: state.topicIndex === 0 ? "" : null,
          onclick: () => { if (state.topicIndex > 0) selectTopic(state.topicIndex - 1); }
        },
        "← Anterior"
      )
    );
    navRow.appendChild(
      el("button",
        { className: "btn btn-primary", onclick: () => setMode("quiz") },
        "Hacer quiz del tema →"
      )
    );
    card.appendChild(navRow);

    if (state.topicIndex < state.data.topics.length - 1) {
      const nextRow = el("div", { className: "nav-buttons-row" });
      nextRow.appendChild(
        el("button",
          { className: "btn btn-outline-primary w-100",
            onclick: () => selectTopic(state.topicIndex + 1)
          },
          `Tema siguiente: ${state.data.topics[state.topicIndex + 1].title}`
        )
      );
      card.appendChild(nextRow);
    }

    v.appendChild(card);
  }

  function makeExpander(label, contentBuilder) {
    const id = `exp-${Math.random().toString(36).slice(2, 9)}`;
    const wrap = el("div", {});
    const btn = el("button",
      { className: "detail-toggle", type: "button", "aria-expanded": "false", "aria-controls": id,
        onclick: (e) => {
          const open = btn.getAttribute("aria-expanded") === "true";
          btn.setAttribute("aria-expanded", open ? "false" : "true");
          content.style.display = open ? "none" : "block";
        }
      },
      el("span", { className: "chev" }, "▶"),
      ` ${label}`
    );
    const content = el("div", { className: "detail-content", id }, contentBuilder());
    wrap.appendChild(btn);
    wrap.appendChild(content);
    return wrap;
  }

  function linkifyBold(text) {
    // escape HTML and **bold** -> <strong>
    const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return esc.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  }

  // ---------- QUIZ ----------
  function startQuiz() {
    const t = state.data.topics[state.topicIndex];
    state.quiz = {
      questions: shuffle(t.questions),
      index: 0,
      answered: false,
      score: 0,
      total: t.questions.length,
      finished: false,
      pareoSelections: []
    };
    renderQuizView();
  }

  function renderQuizView() {
    const v = $("#quizView");
    v.innerHTML = "";
    const q = state.quiz.questions[state.quiz.index];
    const total = state.quiz.questions.length;

    // Header
    v.appendChild(
      el("div", { className: "quiz-header" },
        el("span", {}, `Pregunta ${state.quiz.index + 1} / ${total}`),
        el("span", {}, `Aciertos: ${state.quiz.score}`)
      )
    );

    if (state.quiz.finished) {
      v.appendChild(renderQuizResults());
      return;
    }

    const card = el("article", { className: "quiz-card" });
    card.appendChild(el("span", { className: "question-type-tag" }, friendlyType(q.type)));
    card.appendChild(
      el("span", { className: `difficulty-tag difficulty-${q.difficulty}` }, q.difficulty.toUpperCase())
    );
    card.appendChild(el("h3", { className: "question-prompt" }, q.prompt));

    if (q.type === "multiple" || q.type === "x") {
      renderOptions(card, q);
    } else if (q.type === "short") {
      renderShort(card, q);
    } else if (q.type === "pareo") {
      renderPareo(card, q);
    }

    // Bottom controls
    const controls = el("div", { className: "quiz-controls" });
    controls.appendChild(
      el("button",
        { className: "btn btn-outline-secondary",
          onclick: () => setMode("study")
        },
        "📖 Estudio"
      )
    );
    if (state.quiz.answered) {
      controls.appendChild(
        el("button",
          { className: "btn btn-primary",
            onclick: () => {
              if (state.quiz.index < total - 1) {
                state.quiz.index++;
                state.quiz.answered = false;
                state.quiz.pareoSelections = [];
                renderQuizView();
              } else {
                state.quiz.finished = true;
                renderQuizView();
              }
            }
          },
          state.quiz.index < total - 1 ? "Siguiente →" : "Ver resultado"
        )
      );
    }
    card.appendChild(controls);
    v.appendChild(card);
  }

  function friendlyType(t) {
    return { multiple: "Selección única", x: "Marque con X", short: "Respuesta corta", pareo: "Pareo" }[t] || t;
  }

  function renderOptions(card, q) {
    const letters = ["A", "B", "C", "D", "E", "F"];
    const list = el("div", {});
    const answered = state.quiz.answered;
    const chosen = answered ? state._lastAnswerIndex : -1;
    q.options.forEach((opt, i) => {
      let cls = "option-btn";
      if (answered) {
        if (i === q.answer) cls += " correct";
        else if (i === chosen) cls += " incorrect";
      }
      const btn = el("button",
        { className: cls, type: "button", disabled: answered ? "" : null,
          onclick: () => answerOption(q, i, list)
        },
        el("span", { className: "letter" }, letters[i] || "?"),
        el("span", {}, opt)
      );
      list.appendChild(btn);
    });
    card.appendChild(list);

    if (answered) {
      const ok = chosen === q.answer;
      card.appendChild(buildExplanation(q, ok));
    }
  }

  function answerOption(q, i, list) {
    if (state.quiz.answered) return;
    state.quiz.answered = true;
    state._lastAnswerIndex = i;
    const correct = i === q.answer;
    if (correct) state.quiz.score++;
    recordAnswer(q, correct);

    // Mark buttons
    const buttons = $$("button.option-btn", list);
    buttons.forEach((b, idx) => {
      b.disabled = true;
      if (idx === q.answer) b.classList.add("correct");
      if (idx === i && !correct) b.classList.add("incorrect");
    });

    showToast(correct ? "¡Correcto! 🎉" : "Incorrecto", correct ? "success" : "error");
    renderQuizView(); // re-render to show explanation + Next
    renderGlobalProgress();
    renderTopicsList();
  }

  function buildExplanation(q, ok) {
    return el("div", { className: "explanation-box" },
      el("strong", {}, ok ? "Bien hecho. " : "Repaso: "),
      q.explanation || ""
    );
  }

  function renderShort(card, q) {
    const inputWrap = el("div", {});
    const input = el("input", {
      className: "short-input",
      type: "text",
      placeholder: "Escribe tu respuesta…",
      autocomplete: "off",
      autocapitalize: "off",
      autocorrect: "off",
      disabled: state.quiz.answered ? "" : null
    });
    inputWrap.appendChild(input);

    const submit = el("button",
      { className: "btn btn-primary w-100 mt-2",
        disabled: state.quiz.answered ? "" : null,
        onclick: () => {
          if (state.quiz.answered) return;
          state.quiz.answered = true;
          const val = (input.value || "").trim();
          const ok = isShortAnswerCorrect(val, q.answer);
          if (ok) state.quiz.score++;
          recordAnswer(q, ok);
          showToast(ok ? "¡Correcto! 🎉" : "Casi… revisa la respuesta", ok ? "success" : "error");
          renderQuizView();
          renderGlobalProgress();
          renderTopicsList();
        }
      },
      "Comprobar"
    );
    inputWrap.appendChild(submit);
    card.appendChild(inputWrap);

    if (state.quiz.answered) {
      card.appendChild(el("div", { className: "explanation-box" },
        el("strong", {}, "Respuesta correcta: "),
        q.answer,
        el("br"),
        el("strong", {}, "Por qué: "),
        q.explanation || ""
      ));
    }
  }

  function isShortAnswerCorrect(userAnswer, canonical) {
    if (!userAnswer) return false;
    const normalize = (s) =>
      s.toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // strip accents
        .replace(/[^a-z0-9 ]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    const u = normalize(userAnswer);
    const c = normalize(canonical);
    if (!u || !c) return false;
    if (u === c) return true;
    // accept if user contains every meaningful word of canonical
    const tokens = c.split(" ").filter((t) => t.length >= 3 && !["los", "las", "una", "uno", "del", "que"].includes(t));
    if (tokens.length === 0) return u === c;
    return tokens.every((t) => u.includes(t));
  }

  function renderPareo(card, q) {
    const left = q.left || [];
    const right = q.right || [];
    if (!state.quiz.pareoSelections.length) {
      state.quiz.pareoSelections = left.map(() => -1);
    }
    const table = el("div", { className: "pareo-table" });
    left.forEach((leftText, i) => {
      const row = el("div", { className: "pareo-row" });
      row.appendChild(el("div", { className: "pareo-left" }, leftText));
      const select = el("select",
        { className: "pareo-select", disabled: state.quiz.answered ? "" : null,
          onchange: (e) => { state.quiz.pareoSelections[i] = parseInt(e.target.value, 10); }
        }
      );
      select.appendChild(el("option", { value: -1 }, "— selecciona —"));
      right.forEach((rt, j) => {
        const opt = el("option", { value: j }, rt);
        if (state.quiz.pareoSelections[i] === j) opt.setAttribute("selected", "selected");
        select.appendChild(opt);
      });
      row.appendChild(select);
      if (state.quiz.answered) {
        const correctIdx = q.answer[i];
        const isOk = state.quiz.pareoSelections[i] === correctIdx;
        row.classList.add(isOk ? "correct" : "incorrect");
      }
      table.appendChild(row);
    });
    card.appendChild(table);

    if (!state.quiz.answered) {
      const submit = el("button",
        { className: "btn btn-primary w-100 mt-3",
          onclick: () => {
            if (state.quiz.answered) return;
            const allSelected = state.quiz.pareoSelections.every((s) => s >= 0);
            if (!allSelected) {
              showToast("Selecciona una opción en cada fila", "error");
              return;
            }
            state.quiz.answered = true;
            const ok = state.quiz.pareoSelections.every((s, i) => s === q.answer[i]);
            if (ok) state.quiz.score++;
            recordAnswer(q, ok);
            showToast(ok ? "¡Correcto! 🎉" : "Algunas parejas fallaron", ok ? "success" : "error");
            renderQuizView();
            renderGlobalProgress();
            renderTopicsList();
          }
        },
        "Comprobar"
      );
      card.appendChild(submit);
    } else {
      card.appendChild(el("div", { className: "explanation-box" },
        el("strong", {}, "Explicación: "),
        q.explanation || ""
      ));
    }
  }

  function renderQuizResults() {
    const t = state.data.topics[state.topicIndex];
    const score = state.quiz.score;
    const total = state.quiz.total;
    const pct = total ? Math.round((score / total) * 100) : 0;

    let motivation;
    if (pct >= 90) motivation = "🌟 ¡Dominas el tema! Repasa el siguiente.";
    else if (pct >= 70) motivation = "👍 Muy bien. Repite las que fallaste y avanza.";
    else if (pct >= 50) motivation = "🙂 Vas bien. Vuelve a estudio y reintenta.";
    else motivation = "💪 No te preocupes: vuelve a estudio, este tema necesita una pasada más.";

    const card = el("div", { className: "results-card" },
      el("div", { className: "small text-white-50" }, `Resultados — ${t.title}`),
      el("div", { className: "score" }, `${score} / ${total}`),
      el("div", { className: "small text-white-50" }, `${pct} % de aciertos`),
      el("div", { className: "motivation" }, motivation)
    );

    const wrap = el("div", {},
      card,
      el("div", { className: "quiz-controls" },
        el("button",
          { className: "btn btn-outline-secondary",
            onclick: () => setMode("study")
          },
          "← Volver a estudio"
        ),
        el("button",
          { className: "btn btn-primary",
            onclick: () => startQuiz()
          },
          "Reintentar quiz"
        )
      )
    );

    if (state.topicIndex < state.data.topics.length - 1) {
      wrap.appendChild(
        el("button",
          { className: "btn btn-success w-100 mt-2",
            onclick: () => { selectTopic(state.topicIndex + 1); setMode("study"); }
          },
          `Siguiente tema → ${state.data.topics[state.topicIndex + 1].title}`
        )
      );
    }
    return wrap;
  }

  // ---------- REPASO RÁPIDO (Flashcards interactivas) ----------
  // Convierte un key_point "3 huesos: Frontal, Nasal" en pregunta+respuesta.
  function splitKeyPoint(text, topicTitle) {
    const idx = text.indexOf(":");
    if (idx > 4 && idx <= 60) {
      const q = text.slice(0, idx).trim();
      const a = text.slice(idx + 1).trim();
      const cap = q.charAt(0).toUpperCase() + q.slice(1);
      return [`¿${cap}?`, a];
    }
    return [`Dato clave de "${topicTitle}"`, text];
  }

  function buildRepasoDeck(scope) {
    const topics = scope === "topic"
      ? [state.data.topics[state.topicIndex]]
      : state.data.topics;
    const cards = [];
    for (const t of topics) {
      if (t.idea_central) {
        cards.push({
          key: `idea-${t.id}`,
          topicTitle: t.title, topicId: t.id, kind: "idea",
          prompt: `Resume "${t.title}" en una frase`,
          answer: t.idea_central
        });
      }
      (t.key_points || []).forEach((kp, i) => {
        const [q, a] = splitKeyPoint(kp, t.title);
        cards.push({
          key: `kp-${t.id}-${i}`,
          topicTitle: t.title, topicId: t.id, kind: "keypoint",
          prompt: q, answer: a
        });
      });
      (t.concepts || []).forEach((c, i) => {
        cards.push({
          key: `concept-${t.id}-${i}`,
          topicTitle: t.title, topicId: t.id, kind: "concept",
          prompt: `¿Qué es "${c.term}"?`,
          answer: c.definition
        });
      });
      if (t.mnemonic) {
        cards.push({
          key: `mnem-${t.id}`,
          topicTitle: t.title, topicId: t.id, kind: "mnemonic",
          prompt: `Mnemónica de "${t.title}" — ¿la recuerdas?`,
          answer: t.mnemonic
        });
      }
    }
    return cards;
  }

  function startRepaso(scope) {
    if (scope) state.repaso.scope = scope;
    const cards = buildRepasoDeck(state.repaso.scope);
    const shuffled = shuffle(cards);
    state.repaso.cards = shuffled;
    state.repaso.queueKeys = shuffled.map((c) => c.key);
    state.repaso.currentIdx = 0;
    state.repaso.revealed = false;
    state.repaso.mastered = [];
    state.repaso.toReview = [];
    state.repaso.finished = false;
    renderRepasoView();
  }

  function currentCard() {
    const k = state.repaso.queueKeys[state.repaso.currentIdx];
    return state.repaso.cards.find((c) => c.key === k);
  }

  function advanceRepaso() {
    const r = state.repaso;
    if (r.currentIdx + 1 < r.queueKeys.length) {
      r.currentIdx++;
      r.revealed = false;
    } else {
      r.finished = true;
    }
    renderRepasoView();
  }

  function markMastered() {
    const r = state.repaso;
    const k = r.queueKeys[r.currentIdx];
    if (!r.mastered.includes(k)) r.mastered.push(k);
    r.toReview = r.toReview.filter((x) => x !== k);
    advanceRepaso();
  }

  function markToReview() {
    const r = state.repaso;
    const k = r.queueKeys[r.currentIdx];
    if (!r.toReview.includes(k)) r.toReview.push(k);
    advanceRepaso();
  }

  function repasoOnlyReview() {
    const r = state.repaso;
    if (!r.toReview.length) return;
    r.queueKeys = shuffle([...r.toReview]);
    r.currentIdx = 0;
    r.revealed = false;
    r.toReview = [];
    r.finished = false;
    renderRepasoView();
  }

  function renderRepasoView() {
    const v = $("#repasoView");
    v.innerHTML = "";

    // Onboarding (solo primera vez)
    const TUT_KEY = "anato-repaso-tutorial";
    if (!localStorage.getItem(TUT_KEY)) {
      const tut = el("div", { className: "repaso-tutorial" },
        el("div", { className: "tut-title" }, "👋 ¿Cómo funciona el repaso?"),
        el("ol", { className: "tut-steps" },
          el("li", {}, el("strong", {}, "1. Lee la pregunta"), " en la tarjeta."),
          el("li", {}, el("strong", {}, "2. Piensa la respuesta"), " en tu cabeza."),
          el("li", {}, el("strong", {}, "3. Toca la tarjeta"), " para revelar la respuesta."),
          el("li", {}, el("strong", {}, "4. Evalúate:"), " “La sabía” o “Repasar más”."),
          el("li", {}, el("strong", {}, "5. Al final"), " puedes repetir solo las que fallaste.")
        ),
        el("button",
          { className: "btn btn-primary btn-sm w-100 mt-2",
            onclick: () => { localStorage.setItem(TUT_KEY, "1"); renderRepasoView(); }
          },
          "¡Entendido, empezar!"
        )
      );
      v.appendChild(tut);
      return;
    }

    // Selector de alcance
    const t = state.data.topics[state.topicIndex];
    const scopeBar = el("div", { className: "repaso-scope" },
      el("span", { className: "scope-label" }, "Repasar:"),
      el("button",
        { className: "scope-btn" + (state.repaso.scope === "all" ? " active" : ""),
          onclick: () => { if (state.repaso.scope !== "all") startRepaso("all"); }
        },
        "Todos los temas"
      ),
      el("button",
        { className: "scope-btn" + (state.repaso.scope === "topic" ? " active" : ""),
          onclick: () => { if (state.repaso.scope !== "topic") startRepaso("topic"); }
        },
        `Solo: ${t.title}`
      )
    );
    v.appendChild(scopeBar);

    // Resultados al terminar
    if (state.repaso.finished || !state.repaso.queueKeys.length) {
      const masteredN = state.repaso.mastered.length;
      const reviewN = state.repaso.toReview.length;
      const totalN = state.repaso.cards.length;
      v.appendChild(
        el("div", { className: "repaso-results" },
          el("div", { className: "rr-emoji" }, reviewN === 0 ? "🎉" : "💪"),
          el("div", { className: "rr-title" }, reviewN === 0 ? "¡Las dominaste todas!" : "¡Buen trabajo!"),
          el("div", { className: "rr-stats" },
            el("div", { className: "stat-block stat-ok" },
              el("div", { className: "stat-num" }, masteredN),
              el("div", { className: "stat-lbl" }, "Las sabías")
            ),
            el("div", { className: "stat-block stat-warn" },
              el("div", { className: "stat-num" }, reviewN),
              el("div", { className: "stat-lbl" }, "Para repasar")
            ),
            el("div", { className: "stat-block stat-neutral" },
              el("div", { className: "stat-num" }, totalN),
              el("div", { className: "stat-lbl" }, "Total")
            )
          ),
          reviewN > 0
            ? el("button",
                { className: "btn btn-primary w-100 mt-3", onclick: repasoOnlyReview },
                `Repasar las ${reviewN} pendientes →`
              )
            : null,
          el("button",
            { className: "btn btn-outline-secondary w-100 mt-2",
              onclick: () => startRepaso(state.repaso.scope)
            },
            "🔁 Empezar de nuevo"
          ),
          el("button",
            { className: "btn btn-outline-secondary w-100 mt-2", onclick: () => setMode("study") },
            "📖 Volver a estudio"
          )
        )
      );
      return;
    }

    // Cabecera con progreso
    const total = state.repaso.queueKeys.length;
    const idx = state.repaso.currentIdx + 1;
    const card = currentCard();
    const pctDone = Math.round(((idx - 1) / total) * 100);

    v.appendChild(
      el("div", { className: "repaso-header" },
        el("div", { className: "rh-row" },
          el("span", { className: "rh-counter" }, `Tarjeta ${idx} / ${total}`),
          el("span", { className: "rh-mastered" }, `✓ ${state.repaso.mastered.length}`)
        ),
        el("div", { className: "rh-bar" },
          el("div", { className: "rh-bar-fill", style: `width:${pctDone}%` })
        )
      )
    );

    // Tarjeta con flip 3D
    const kindIcon = { idea: "🎯", keypoint: "📌", concept: "💡", mnemonic: "🧠" }[card.kind] || "📝";
    const kindLabel = { idea: "Idea central", keypoint: "Punto clave", concept: "Concepto", mnemonic: "Mnemónica" }[card.kind] || "Tarjeta";

    const flashcard = el("div", { className: "flashcard" + (state.repaso.revealed ? " flipped" : "") });
    const inner = el("div", { className: "flashcard-inner" });

    // Cara frontal: pregunta
    const front = el("div", { className: "flashcard-face front" },
      el("div", { className: "fc-kind" }, `${kindIcon} ${kindLabel} · ${card.topicTitle}`),
      el("div", { className: "fc-prompt" }, card.prompt),
      el("div", { className: "fc-hint" }, "Piensa tu respuesta y toca para revelar 👆")
    );
    // Cara trasera: respuesta
    const back = el("div", { className: "flashcard-face back" },
      el("div", { className: "fc-kind back" }, `${kindIcon} Respuesta`),
      el("div", { className: "fc-answer" }, card.answer),
      el("div", { className: "fc-hint" }, "¿Te la sabías?")
    );

    inner.appendChild(front);
    inner.appendChild(back);
    flashcard.appendChild(inner);

    if (!state.repaso.revealed) {
      flashcard.setAttribute("role", "button");
      flashcard.setAttribute("tabindex", "0");
      flashcard.setAttribute("aria-label", "Mostrar respuesta");
      const flip = () => { state.repaso.revealed = true; renderRepasoView(); };
      flashcard.onclick = flip;
      flashcard.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); flip(); } };
    }

    v.appendChild(flashcard);

    // Acciones según estado
    if (!state.repaso.revealed) {
      v.appendChild(
        el("button",
          { className: "btn btn-primary w-100 mt-3 reveal-btn",
            onclick: () => { state.repaso.revealed = true; renderRepasoView(); }
          },
          "Mostrar respuesta 👁️"
        )
      );
    } else {
      const evalRow = el("div", { className: "repaso-eval" },
        el("button",
          { className: "btn-eval btn-eval-warn", onclick: markToReview, "aria-label": "Repasar más" },
          el("span", { className: "ev-emoji" }, "🔁"),
          el("span", { className: "ev-text" }, "Repasar más")
        ),
        el("button",
          { className: "btn-eval btn-eval-ok", onclick: markMastered, "aria-label": "La sabía" },
          el("span", { className: "ev-emoji" }, "✓"),
          el("span", { className: "ev-text" }, "La sabía")
        )
      );
      v.appendChild(evalRow);
    }

    // Atajos de teclado (solo desktop)
    v.tabIndex = -1;
    v.onkeydown = (e) => {
      if (e.key === " " && !state.repaso.revealed) {
        e.preventDefault();
        state.repaso.revealed = true; renderRepasoView();
      } else if (state.repaso.revealed && (e.key === "1" || e.key === "ArrowLeft")) {
        markToReview();
      } else if (state.repaso.revealed && (e.key === "2" || e.key === "ArrowRight" || e.key === "Enter")) {
        markMastered();
      }
    };

    // Salir del repaso
    v.appendChild(
      el("button",
        { className: "btn btn-link w-100 mt-2 text-secondary", onclick: () => setMode("study") },
        "↩ Volver a estudio"
      )
    );
  }

  // ---------- HOME ----------
  function renderHome() {
    // weakness list
    const ul = $("#weaknessList");
    ul.innerHTML = "";
    state.data.weaknesses.forEach((w) => {
      ul.appendChild(
        el("li", {},
          el("strong", {}, `${w.pattern}: `),
          w.tip
        )
      );
    });
  }

  // ---------- TOAST ----------
  let toastTimer;
  function showToast(msg, kind = "") {
    const t = $("#feedbackToast");
    t.textContent = msg;
    t.classList.remove("success", "error");
    if (kind) t.classList.add(kind);
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 1600);
  }

  // ---------- IMAGE VIEWER (lightbox) ----------
  function openImageViewer(src, caption) {
    let lb = $("#imageLightbox");
    if (!lb) {
      lb = el("div", { id: "imageLightbox", className: "image-lightbox", role: "dialog", "aria-modal": "true" });
      lb.appendChild(el("button", {
        className: "lightbox-close", type: "button", "aria-label": "Cerrar imagen",
        onclick: closeImageViewer
      }, "✕"));
      lb.appendChild(el("img", { id: "lightboxImg", alt: "" }));
      lb.appendChild(el("div", { id: "lightboxCaption", className: "lightbox-caption" }));
      lb.addEventListener("click", (e) => { if (e.target === lb) closeImageViewer(); });
      document.body.appendChild(lb);
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && lb.classList.contains("show")) closeImageViewer();
      });
    }
    $("#lightboxImg").src = src;
    $("#lightboxImg").alt = caption || "";
    $("#lightboxCaption").textContent = caption || "";
    lb.classList.add("show");
    document.body.style.overflow = "hidden";
  }
  function closeImageViewer() {
    const lb = $("#imageLightbox");
    if (lb) lb.classList.remove("show");
    document.body.style.overflow = "";
  }

  // ---------- INIT ----------
  async function init() {
    try {
      const res = await fetch("data.json", { cache: "no-cache" });
      if (!res.ok) throw new Error(`No se pudo cargar data.json (HTTP ${res.status})`);
      state.data = await res.json();
    } catch (e) {
      $("#mainArea").innerHTML =
        `<div class="alert alert-danger mt-4" role="alert">
           <strong>Error al cargar los datos:</strong> ${e.message}<br>
           Si abriste el archivo directamente, sirve la carpeta con un servidor local o publícala en GitHub Pages.
         </div>`;
      return;
    }

    document.title = state.data.meta.title;
    renderTopicsList();
    renderGlobalProgress();
    renderHome();

    // bind UI
    $("#startStudyBtn").addEventListener("click", () => {
      selectTopic(0);
      $("#homeView").classList.add("d-none");
      setMode("study");
    });
    $("#startQuickBtn").addEventListener("click", () => {
      $("#homeView").classList.add("d-none");
      setMode("repaso");
    });
    $("#repasoButton").addEventListener("click", () => {
      $("#homeView").classList.add("d-none");
      setMode("repaso");
    });
    $$(".bottom-nav-btn").forEach((b) => {
      b.addEventListener("click", () => {
        $("#homeView").classList.add("d-none");
        setMode(b.dataset.mode);
      });
    });
    $("#resetProgressBtn").addEventListener("click", () => {
      if (confirm("¿Reiniciar todo el progreso?")) resetProgress();
    });

    // Initial: home shown, study pre-rendered for topic 0
    selectTopic(0);
    // Show home view first if no progress yet
    const s = globalStats();
    if (s.answered === 0) {
      $("#homeView").classList.remove("d-none");
      // hide all other views
      ["studyView", "quizView", "repasoView"].forEach((id) => $(`#${id}`).classList.add("d-none"));
    } else {
      $("#homeView").classList.add("d-none");
      setMode("study");
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
