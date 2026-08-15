(function (global) {
  "use strict";

  const DRAFT_KEY = "wikist.community.qa.draft";
  const WIKI_DRAFT_KEY = "wikist.community.qa.wiki-draft";
  const DRAFT_TTL = 30 * 60 * 1000;

  function parseValue(value) {
    const [pathValue, query = ""] = String(value || "").split("?");
    return { pathValue, params: new URLSearchParams(query) };
  }

  function pageInfo(payload, fallbackPage = 1, fallbackLimit = 12) {
    const pagination = payload?.pagination || payload || {};
    const page = Math.max(1, Number(pagination.page) || fallbackPage);
    const limit = Math.max(1, Number(pagination.limit || pagination.pageSize) || fallbackLimit);
    const total = Math.max(0, Number(pagination.total) || 0);
    const pages = Math.max(1, Number(pagination.pages || pagination.totalPages) || Math.ceil(total / limit) || 1);
    return { page, limit, total, pages };
  }

  function readDraft(kind = "") {
    try {
      const draft = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || "null");
      if (!draft || Date.now() - Number(draft.createdAt || 0) > DRAFT_TTL) return null;
      return !kind || draft.kind === kind ? draft : null;
    } catch (_error) {
      return null;
    }
  }

  function writeDraft(draft) {
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ ...draft, createdAt: Date.now() }));
    } catch (_error) {}
  }

  function clearDraft(kind = "") {
    const draft = readDraft();
    if (!kind || draft?.kind === kind) {
      try { sessionStorage.removeItem(DRAFT_KEY); } catch (_error) {}
    }
  }

  function quoteMarkdown(text, label, url) {
    const quote = String(text || "").trim().split("\n").map((line) => `> ${line}`).join("\n");
    const safeLabel = String(label || "正文来源").replace(/[\[\]\r\n]/g, " ");
    const source = String(url || "").startsWith("#/") ? `[${safeLabel}](${url})` : safeLabel;
    return `${quote}\n\n来源：${source}`;
  }

  function questionDraftFromSource(source, selectedText = "") {
    const label = String(source?.label || source?.id || "这段内容");
    const exact = String(selectedText || source?.selectedText || "").trim();
    writeDraft({
      kind: "question",
      title: exact ? `关于“${exact.slice(0, 36)}”的问题` : `关于“${label}”的问题`,
      content: exact
        ? `${quoteMarkdown(exact, label, source?.url)}\n\n请说明你的问题、已知条件与尝试过程。`
        : `问题来源：[[${source?.id || ""}|${label}]]\n\n请说明你的问题、已知条件与尝试过程。`,
      source: { ...source, selectedText: exact },
    });
  }

  function answerDraft(questionId, markdown, selection = null) {
    writeDraft({ kind: "answer", questionId: String(questionId || ""), content: String(markdown || ""), selection });
    const form = document.querySelector(`#qaAnswerForm[data-question-id="${global.CSS?.escape ? CSS.escape(String(questionId)) : String(questionId)}"]`);
    const textarea = form?.querySelector("textarea[name='content']");
    if (textarea) {
      textarea.value = `${textarea.value.trim() ? `${textarea.value.trim()}\n\n` : ""}${String(markdown || "").trim()}`;
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      textarea.focus();
      textarea.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  class CommunityQaController {
    constructor(options) {
      this.root = options.root;
      this.api = options.api;
      this.state = options.state || {};
      this.escape = options.escapeHtml;
      this.avatar = options.avatarHtml;
      this.icon = options.iconHtml;
      this.selectionAttributes = options.selectionAttributes || (() => "");
      this.setTitle = options.setTitle || (() => {});
      this.renderToc = options.renderToc || (() => {});
      this.typeset = options.typeset || (() => {});
      this.toast = options.toast || (() => {});
      this.alert = options.alert || (() => {});
      this.confirm = options.confirm || (async () => false);
      this.prompt = options.prompt || (async () => null);
      this.embedded = Boolean(options.embedded);
      this.organization = options.organization || null;
      this.routeBase = options.routeBase || "#/questions";
      this.bootstrap = null;
      this.currentValue = "";
      this.detailAbort = null;
    }

    releaseDetailBindings() {
      const active = this.root?.__wikistCommunityQaDetailAbort || null;
      active?.abort();
      if (this.detailAbort && this.detailAbort !== active) this.detailAbort.abort();
      this.detailAbort = null;
      if (this.root) delete this.root.__wikistCommunityQaDetailAbort;
    }

    routeHref(params = new URLSearchParams()) {
      const [path, baseQuery = ""] = this.routeBase.split("?");
      const query = new URLSearchParams(baseQuery);
      new URLSearchParams(params).forEach((value, key) => {
        if (value !== "" && !(key === "page" && Number(value) === 1)) query.set(key, value);
        else if (key !== "tab") query.delete(key);
      });
      return `${path}${query.toString() ? `?${query.toString()}` : ""}`;
    }

    async render(value = "") {
      this.releaseDetailBindings();
      this.currentValue = value;
      const parsed = parseValue(value);
      if (parsed.pathValue === "tags") return this.renderTags(parsed.params);
      if (parsed.pathValue === "collections") return this.renderCollections(parsed.params);
      if (parsed.pathValue === "follows") return this.renderFollows(parsed.params);
      if (parsed.pathValue === "activity") return this.renderActivity(parsed.params);
      if (parsed.pathValue) return this.renderQuestion(parsed.pathValue, parsed.params);
      return this.renderQuestions(parsed.params);
    }

    communityNav(active = "questions") {
      const items = [
        ["questions", "问题", "#/questions"],
        ["tags", "标签", "#/questions/tags"],
        ["collections", "我的收藏", "#/questions/collections"],
        ["follows", "我的关注", "#/questions/follows"],
      ];
      return `<nav class="qa-section-tabs" aria-label="问答社区分区">${items.map(([id, label, href]) => `<a class="${active === id ? "active" : ""}" href="${href}" ${active === id ? 'aria-current="page"' : ""}>${label}</a>`).join("")}</nav>`;
    }

    subpagePager(payload, section, params = {}) {
      const info = pageInfo(payload, 1, 20);
      if (!info.total) return "";
      const href = (page) => {
        const query = new URLSearchParams(params);
        if (page > 1) query.set("page", String(page)); else query.delete("page");
        return `#/questions/${section}${query.toString() ? `?${query}` : ""}`;
      };
      if (info.pages <= 1) return `<footer class="qa-pager is-single"><span>共 ${info.total} 条</span></footer>`;
      return `<nav class="qa-pager" aria-label="${this.escape(section)}分页"><a class="${info.page <= 1 ? "is-disabled" : ""}" href="${href(Math.max(1, info.page - 1))}">上一页</a><span>第 ${info.page} / ${info.pages} 页 · 共 ${info.total} 条</span><a class="${info.page >= info.pages ? "is-disabled" : ""}" href="${href(Math.min(info.pages, info.page + 1))}">下一页</a></nav>`;
    }

    async renderTags(params) {
      const page = Math.max(1, Number(params.get("page")) || 1);
      const query = String(params.get("q") || "").trim();
      const [bootstrap, payload] = await Promise.all([this.loadBootstrap(), this.api(`/api/community/qa/tags?page=${page}&limit=24&q=${encodeURIComponent(query)}`)]);
      this.setTitle("社区标签");
      this.renderToc([]);
      this.root.innerHTML = `<section class="community-qa-shell"><header class="article-head qa-page-head"><div><span class="system-kicker">Community Taxonomy</span><h1>社区标签</h1><p class="article-summary">按数学主题浏览问题，并关注需要持续跟进的领域。</p></div></header>${this.communityNav("tags")}${this.serviceStateHtml(bootstrap, payload)}<form class="qa-tag-search" id="qaTagSearch"><input name="q" type="search" value="${this.escape(query)}" placeholder="搜索标签名称" /><button class="qa-search-button" type="submit">${this.icon("search")}<span>搜索</span></button></form><section class="qa-tag-grid">${(payload.items || []).length ? payload.items.map((tag) => `<article><header><a href="#/questions?tag=${encodeURIComponent(tag.name)}"><strong>${this.escape(tag.name)}</strong><small>${this.escape(tag.slug)}</small></a>${tag.recommended ? '<span>推荐</span>' : ""}</header><p>${this.escape(tag.descriptionMd || "浏览该主题下的社区问题。")}</p><footer><span>${Number(tag.questionCount || 0)} 个问题 · ${Number(tag.followerCount || 0)} 人关注</span>${this.state.user ? `<button class="qa-tag-follow ${tag.followed ? "active" : ""}" type="button" data-qa-tag-follow="${this.escape(tag.slug)}">${tag.followed ? "已关注" : "关注"}</button>` : ""}</footer></article>`).join("") : '<div class="qa-empty-state"><h2>没有匹配的标签</h2><p>发布问题时可以创建新的主题标签。</p></div>'}</section>${this.subpagePager(payload, "tags", { q: query })}</section>`;
      this.root.querySelector("#qaTagSearch")?.addEventListener("submit", (event) => { event.preventDefault(); const q = String(new FormData(event.currentTarget).get("q") || "").trim(); location.hash = `#/questions/tags${q ? `?q=${encodeURIComponent(q)}` : ""}`; });
      this.root.querySelectorAll("[data-qa-tag-follow]").forEach((button) => button.addEventListener("click", async () => {
        if (button.dataset.pending === "true") return;
        button.dataset.pending = "true";
        button.setAttribute("aria-busy", "true");
        try { const result = await this.api(`/api/community/qa/objects/tag/${encodeURIComponent(button.dataset.qaTagFollow)}/follow`, { method: "POST", body: JSON.stringify({ notificationLevel: "all" }) }); button.classList.toggle("active", result.active); button.setAttribute("aria-pressed", String(Boolean(result.active))); button.textContent = result.active ? "已关注" : "关注"; } catch (error) { await this.alert("关注失败", error.message, "error"); } finally { delete button.dataset.pending; button.removeAttribute("aria-busy"); }
      }));
    }

    async renderCollections(params) {
      this.setTitle("社区收藏");
      this.renderToc([]);
      if (!this.state.user) {
        this.root.innerHTML = `<section class="community-qa-shell">${this.communityNav("collections")}<div class="qa-empty-state"><h1>登录后查看社区收藏</h1><p>问题与回答会保存在你的 Wikist 账户中。</p><a class="qa-primary-action" href="/passport?mode=login">登录 Passport</a></div></section>`;
        return;
      }
      const page = Math.max(1, Number(params.get("page")) || 1);
      const payload = await this.api(`/api/community/qa/collections?page=${page}&limit=20`);
      this.root.innerHTML = `<section class="community-qa-shell"><header class="article-head qa-page-head"><div><span class="system-kicker">Knowledge Collection</span><h1>社区收藏</h1><p class="article-summary">保存需要继续阅读、验证或整理回词条的问答内容。</p></div></header>${this.communityNav("collections")}<section class="qa-collection-list">${(payload.items || []).length ? payload.items.map((item) => `<article><a href="${this.escape(item.url || "#/questions")}"><span>${item.type === "answer" ? "回答" : "问题"}</span><strong>${this.escape(item.title || "社区内容")}</strong><p>${this.escape(item.summary || "")}</p><small>${this.formatDate(item.collectedAt)}</small></a><button type="button" data-qa-remove-collection data-object-type="${this.escape(item.type)}" data-object-id="${this.escape(item.id)}">取消收藏</button></article>`).join("") : '<div class="qa-empty-state"><h2>还没有社区收藏</h2><p>在问题或回答下点击“收藏”即可加入这里。</p></div>'}</section>${this.subpagePager(payload, "collections")}</section>`;
      this.root.querySelectorAll("[data-qa-remove-collection]").forEach((button) => button.addEventListener("click", async () => {
        if (button.dataset.pending === "true") return;
        button.dataset.pending = "true";
        button.setAttribute("aria-busy", "true");
        try { await this.api(`/api/community/qa/objects/${encodeURIComponent(button.dataset.objectType)}/${encodeURIComponent(button.dataset.objectId)}/collection`, { method: "POST", body: "{}" }); button.closest("article")?.remove(); this.toast("已取消收藏"); } catch (error) { await this.alert("操作失败", error.message, "error"); } finally { delete button.dataset.pending; button.removeAttribute("aria-busy"); }
      }));
    }

    async renderFollows(params) {
      this.setTitle("社区关注");
      this.renderToc([]);
      if (!this.state.user) {
        this.root.innerHTML = `<section class="community-qa-shell">${this.communityNav("follows")}<div class="qa-empty-state"><h1>登录后查看社区关注</h1><p>关注的问题和标签会保存到你的 Wikist 账户。</p><a class="qa-primary-action" href="/passport?mode=login">登录 Passport</a></div></section>`;
        return;
      }
      const page = Math.max(1, Number(params.get("page")) || 1);
      const payload = await this.api(`/api/community/qa/follows?page=${page}&limit=20`);
      this.root.innerHTML = `<section class="community-qa-shell"><header class="article-head qa-page-head"><div><span class="system-kicker">Knowledge Watch</span><h1>社区关注</h1><p class="article-summary">持续接收问题更新、回答与标签动态。</p></div></header>${this.communityNav("follows")}<section class="qa-collection-list">${(payload.items || []).length ? payload.items.map((item) => `<article class="${item.status === "closed" ? "is-closed" : ""}"><a href="${this.escape(item.url || "#/questions")}"><span>${item.type === "tag" ? "标签" : "问题"}${item.status === "closed" ? " · 已关闭" : ""}</span><strong>${this.escape(item.title || "社区内容")}</strong><p>${this.escape(item.summary || "")}</p><small>${this.formatDate(item.followedAt)}</small></a><button type="button" data-qa-remove-follow data-object-type="${this.escape(item.type)}" data-object-id="${this.escape(item.id)}">取消关注</button></article>`).join("") : '<div class="qa-empty-state"><h2>还没有社区关注</h2><p>关注问题或标签后，更新会进入你的通知中心。</p></div>'}</section>${this.subpagePager(payload, "follows")}</section>`;
      this.root.querySelectorAll("[data-qa-remove-follow]").forEach((button) => button.addEventListener("click", async () => {
        button.dataset.pending = "true";
        try {
          await this.api(`/api/community/qa/objects/${encodeURIComponent(button.dataset.objectType)}/${encodeURIComponent(button.dataset.objectId)}/follow`, { method: "POST", body: "{}" });
          button.closest("article")?.remove();
          this.toast("已取消关注");
        } catch (error) {
          await this.alert("操作失败", error.message, "error");
        } finally {
          delete button.dataset.pending;
        }
      }));
    }

    async renderActivity(params) {
      const page = Math.max(1, Number(params.get("page")) || 1);
      const payload = await this.api(`/api/community/qa/activity?page=${page}&limit=24`);
      const labels = { "question.created": "发布问题", "question.updated": "更新问题", "answer.created": "发布回答", "answer.updated": "更新回答", "answer.accepted": "采纳回答", "answer.acceptance_revoked": "撤销采纳", "comment.created": "发表评论", "question.closed": "关闭问题", "question.reopened": "重新打开问题" };
      this.setTitle("社区动态");
      this.renderToc([]);
      this.root.innerHTML = `<section class="community-qa-shell"><header class="article-head qa-page-head"><div><span class="system-kicker">Activity Stream</span><h1>社区动态</h1><p class="article-summary">查看你有权访问的公共与组织知识活动。</p></div></header>${this.communityNav("activity")}<section class="qa-activity-list">${(payload.items || []).length ? payload.items.map((item) => { const metadata = item.metadata || {}; const questionId = metadata.questionId || (item.objectType === "question" ? metadata.publicId : ""); const objectId = metadata.publicId || ""; const href = questionId ? `#/questions/${encodeURIComponent(questionId)}${item.objectType === "answer" && objectId ? `?answer=${encodeURIComponent(objectId)}` : ""}` : ""; const content = `<strong>${this.escape(labels[item.eventType] || "社区内容更新")}</strong><small>${this.escape(metadata.title || ({ answer: "社区回答", comment: "社区评论", question: "社区问题" })[item.objectType] || "社区内容")}</small>`; return `<article><span class="qa-activity-marker"></span><div>${this.authorHtml(item.actor || {}, item.createdAt)}${href ? `<a class="qa-activity-object" href="${href}">${content}</a>` : content}</div></article>`; }).join("") : '<div class="qa-empty-state"><h2>还没有社区动态</h2><p>发布问题或回答后，活动会显示在这里。</p></div>'}</section>${this.subpagePager(payload, "activity")}</section>`;
    }

    async loadBootstrap() {
      this.bootstrap = await this.api("/api/community/qa/bootstrap");
      return this.bootstrap;
    }

    serviceStateHtml(bootstrap, payload = {}) {
      if (!bootstrap.enabled || payload.degraded) {
        return `<aside class="qa-service-state is-degraded"><span class="qa-status-dot"></span><div><strong>社区暂时不可用</strong><small>${this.escape(payload.notice || "请稍后重试。")}</small></div></aside>`;
      }
      return "";
    }

    identityActionHtml(bootstrap, label = "发起问题") {
      if (!this.state.user) return `<a class="qa-primary-action" href="/passport?mode=login">登录后${this.escape(label)}</a>`;
      if (!bootstrap.enabled) return `<button class="qa-primary-action" type="button" disabled>问答引擎未启用</button>`;
      return `<button class="qa-primary-action" type="button" data-qa-compose>${this.escape(label)}</button>`;
    }

    authorHtml(author = {}, date = "") {
      const name = author.displayName || author.username || "社区成员";
      const profile = author.username ? `#/user/${encodeURIComponent(author.username)}` : "";
      const identity = `${this.avatar(author, "small")}<span><strong>${this.escape(name)}</strong>${author.username ? `<small>@${this.escape(author.username)}</small>` : ""}</span>`;
      return `<div class="qa-author">${profile ? `<a href="${profile}">${identity}</a>` : `<span>${identity}</span>`}<time>${this.formatDate(date)}</time></div>`;
    }

    formatDate(value) {
      if (!value) return "";
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return "";
      return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
    }

    bodyHtml(item = {}) {
      if (String(item.bodyHtml || "").trim()) return this.decorateHtml(String(item.bodyHtml));
      let text = this.escape(String(item.bodyMd || item.summary || ""));
      text = text.replace(/\{\{ref:([a-z_]+)\|([^|{}]+)\|([^{}]+)\}\}/gi, (_match, type, id, label) => this.referenceInline(type, id, label));
      text = text.replace(/\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]/g, (_match, slug, label) => this.referenceInline("wiki_entry", String(slug).trim(), String(label || slug).trim()));
      text = text.replace(/`([^`\n]+)`/g, "<code>$1</code>");
      return text.split(/\n{2,}/).map((paragraph) => `<p>${paragraph.replace(/\n/g, "<br>")}</p>`).join("");
    }

    decorateHtml(html) {
      const template = document.createElement("template");
      template.innerHTML = html;
      const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      nodes.forEach((node) => {
        if (!node.nodeValue || node.parentElement?.closest("a,code,pre,script,style,textarea")) return;
        const source = node.nodeValue;
        const pattern = /\{\{ref:([a-z_]+)\|([^|{}]+)\|([^{}]+)\}\}|\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]/gi;
        let cursor = 0;
        let match;
        const fragment = document.createDocumentFragment();
        while ((match = pattern.exec(source))) {
          fragment.append(document.createTextNode(source.slice(cursor, match.index)));
          const shell = document.createElement("template");
          shell.innerHTML = match[1]
            ? this.referenceInline(match[1], String(match[2]).trim(), String(match[3]).trim())
            : this.referenceInline("wiki_entry", String(match[4]).trim(), String(match[5] || match[4]).trim());
          fragment.append(shell.content.cloneNode(true));
          cursor = pattern.lastIndex;
        }
        if (cursor === 0) return;
        fragment.append(document.createTextNode(source.slice(cursor)));
        node.replaceWith(fragment);
      });
      return template.innerHTML;
    }

    referenceInline(type, id, label) {
      const normalized = String(type || "").toLowerCase();
      const labels = {
        wiki_entry: "Wikist 词条",
        page: "Wikist 页面",
        revision: "词条修订",
        question: "社区问题",
        answer: "社区回答",
        organization: "协作组织",
        user: "用户",
      };
      const routes = {
        wiki_entry: `#/page/${encodeURIComponent(id).replace(/%2F/gi, "/")}`,
        page: `#/page/${encodeURIComponent(id).replace(/%2F/gi, "/")}`,
        question: `#/questions/${encodeURIComponent(id)}`,
        answer: `#/knowledge?type=answer&id=${encodeURIComponent(id)}`,
        organization: `#/organization/${encodeURIComponent(id)}`,
        user: `#/user/${encodeURIComponent(id)}`,
      };
      const icon = normalized === "user" ? "members" : normalized === "organization" ? "community" : normalized === "question" || normalized === "answer" ? "forum" : "network";
      return `<a class="qa-knowledge-reference" href="${routes[normalized] || "#/knowledge"}" data-object-type="${this.escape(normalized)}" data-object-id="${this.escape(id)}"><span class="qa-knowledge-reference-icon">${this.icon(icon)}</span><span class="qa-knowledge-reference-copy"><small>${this.escape(labels[normalized] || "知识对象")}</small><strong>${this.escape(label || id)}</strong><em>${this.escape(id)}</em></span><span class="qa-knowledge-reference-open">查看</span></a>`;
    }

    pager(info, baseParams, label = "问答") {
      if (!info.total) return "";
      const href = (page) => {
        const params = new URLSearchParams(baseParams);
        if (page > 1) params.set("page", String(page)); else params.delete("page");
        return this.routeHref(params);
      };
      if (info.pages <= 1) return `<footer class="qa-pager is-single"><span>共 ${info.total} 条</span></footer>`;
      return `<nav class="qa-pager" aria-label="${this.escape(label)}分页"><a class="${info.page <= 1 ? "is-disabled" : ""}" href="${href(Math.max(1, info.page - 1))}" ${info.page <= 1 ? 'aria-disabled="true" tabindex="-1"' : ""}>上一页</a><span>第 ${info.page} / ${info.pages} 页 · 共 ${info.total} 条</span><a class="${info.page >= info.pages ? "is-disabled" : ""}" href="${href(Math.min(info.pages, info.page + 1))}" ${info.page >= info.pages ? 'aria-disabled="true" tabindex="-1"' : ""}>下一页</a></nav>`;
    }

    questionRow(question, options = {}) {
      const answerCount = Number(question.answerCount || 0);
      const accepted = Boolean(question.acceptedAnswerId);
      const closed = Boolean(question.closed || question.status === "closed");
      const href = `#/questions/${encodeURIComponent(question.id)}${options.answerPicker ? "?useDraft=1" : ""}`;
      const tagHref = (tag) => this.routeHref(new URLSearchParams({ tag, ...(options.origin ? { origin: options.origin } : {}), ...(this.organization?.slug ? { organization: this.organization.slug } : {}) }));
      return `<article class="qa-question-row ${accepted ? "is-solved" : ""} ${closed ? "is-closed" : ""}">
        <div class="qa-question-metrics"><span><strong>${Number(question.voteCount || 0)}</strong><small>赞同</small></span><span class="${answerCount ? "is-active" : ""}"><strong>${answerCount}</strong><small>回答</small></span><span><strong>${Number(question.viewCount || 0)}</strong><small>浏览</small></span></div>
        <div class="qa-question-copy"><a href="${href}"><div class="qa-question-title-row"><h2>${this.escape(question.title)}</h2>${closed ? '<span class="qa-closed-label">已关闭</span>' : ""}</div><p>${this.escape(question.summary || "等待补充问题摘要。")}</p></a>${this.questionOriginsHtml(question, true)}<footer><div class="qa-tag-list">${(question.tags || []).slice(0, 6).map((tag) => `<a href="${tagHref(tag)}">${this.escape(tag)}</a>`).join("")}</div>${this.authorHtml(question.author, question.updatedAt || question.createdAt)}</footer></div>
      </article>`;
    }

    questionOriginsHtml(question, compact = false) {
      const labels = {
        organization: "协作组织",
        selection: "正文划词",
        wiki_entry: "词条",
        page: "页面",
        question: "社区问题",
        answer: "社区回答",
      };
      const origins = Array.isArray(question?.origins) ? question.origins : [];
      if (!origins.length) return "";
      return `<div class="qa-origin-list ${compact ? "is-compact" : ""}" aria-label="问题来源">${origins.map((origin) => {
        const type = String(origin.type || "page");
        const label = String(origin.label || origin.id || labels[type] || "来源");
        const prefix = labels[type] || "来源";
        const text = compact ? `${prefix} · ${label}` : `来自${prefix}：${label}`;
        const icon = type === "organization" ? "community" : type === "selection" ? "edit" : "article";
        const content = `${this.icon(icon)}<span>${this.escape(text)}</span>`;
        return origin.url ? `<a class="qa-origin-chip is-${this.escape(type)}" href="${this.escape(origin.url)}" title="${this.escape(origin.excerpt || text)}">${content}</a>` : `<span class="qa-origin-chip is-${this.escape(type)}" title="${this.escape(origin.excerpt || text)}">${content}</span>`;
      }).join("")}</div>`;
    }

    clearActionHtml(label = "清空输入") {
      return `<button class="qa-secondary-action qa-clear-action" type="button" data-qa-clear-form>${this.icon("delete")}<span>${this.escape(label)}</span></button>`;
    }

    composerHtml(draft, bootstrap, organizationSlug = "") {
      const source = draft?.source || null;
      return `<section class="qa-composer" id="qaComposer" ${draft ? "" : "hidden"}>
        <header><div><span class="system-kicker">Ask Wikist Community</span><h2>发起问题</h2><p>写明问题、已知条件、尝试过程与可核验来源。</p></div><button class="qa-icon-button" type="button" data-qa-compose-close aria-label="收起提问">×</button></header>
        ${source ? `<aside class="qa-source-context"><span>${this.icon("article")}</span><div><strong>${this.escape(source.label || "正文来源")}</strong><small>${this.escape(String(source.selectedText || source.id || "").slice(0, 180))}</small></div></aside>` : ""}
        <form id="qaQuestionForm"><input type="hidden" name="organization" value="${this.escape(organizationSlug)}"><label class="wikist-field"><span>问题标题</span><input class="wikist-input" name="title" required minlength="6" maxlength="150" value="${this.escape(draft?.title || "")}" placeholder="用一句完整的话说明问题" /></label><label class="wikist-field"><span>问题正文</span><textarea class="wikist-input" name="content" required minlength="10" maxlength="65535" rows="10" placeholder="支持 Markdown、数学公式、[[词条]] 与 {{ref:type|id|label}}">${this.escape(draft?.content || "")}</textarea></label>${this.attachmentPicker()}<label class="wikist-field"><span>标签</span><input class="wikist-input" name="tags" required value="${this.escape((draft?.tags || []).join(", "))}" placeholder="例如：群论, 商群, 正规子群" /></label><footer><p class="status-line" aria-live="polite"></p><div class="qa-form-actions">${this.clearActionHtml()}<button class="qa-primary-action" type="submit">发布问题</button></div></footer></form>
      </section>`;
    }

    async renderQuestions(params = new URLSearchParams()) {
      const page = Math.max(1, Number(params.get("page")) || 1);
      const query = String(params.get("q") || "").trim();
      const order = String(params.get("order") || "active");
      const tag = String(params.get("tag") || "");
      const origin = String(params.get("origin") || "");
      const organizationSlug = this.organization?.slug || String(params.get("organization") || "");
      const request = new URLSearchParams({ page: String(page), limit: "12", q: query, order, tag, origin, organization: organizationSlug });
      const [bootstrap, payload] = await Promise.all([this.loadBootstrap(), this.api(`/api/community/qa/questions?${request.toString()}`)]);
      const items = payload.items || [];
      const info = pageInfo(payload, page, 12);
      const draft = readDraft("question");
      const answerPickerDraft = readDraft("answer");
      const choosingAnswerTarget = Boolean(answerPickerDraft && !answerPickerDraft.questionId);
      const composeOpen = Boolean(draft || params.get("compose") === "1");
      if (!this.embedded) {
        this.setTitle("问答与讨论");
        this.renderToc([]);
      }
      const header = this.embedded ? "" : `<header class="article-head qa-page-head"><div><span class="system-kicker">Wikist Community</span><h1>问答与讨论</h1><p class="article-summary">从问题出发形成可验证的回答，并将成熟结论回流词条。</p></div>${this.identityActionHtml(bootstrap)}</header>`;
      this.root.innerHTML = `<section class="community-qa-shell ${this.embedded ? "is-embedded" : ""}">${header}${this.embedded ? "" : this.communityNav("questions")}${this.serviceStateHtml(bootstrap, payload)}
        <section class="qa-list-toolbar"><form id="qaSearchForm"><label class="qa-search-field"><span>搜索问答</span><input name="q" type="search" value="${this.escape(query)}" placeholder="搜索问题、回答、词条引用或标签" /></label><label class="qa-search-order"><span>排序</span><select name="order"><option value="active" ${order === "active" ? "selected" : ""}>最近活跃</option><option value="newest" ${order === "newest" ? "selected" : ""}>最新问题</option><option value="hot" ${order === "hot" ? "selected" : ""}>热门讨论</option><option value="recommend" ${order === "recommend" ? "selected" : ""}>优质推荐</option><option value="score" ${order === "score" ? "selected" : ""}>高分优先</option><option value="frequent" ${order === "frequent" ? "selected" : ""}>浏览最多</option><option value="unanswered" ${order === "unanswered" ? "selected" : ""}>等待回答</option></select></label><label class="qa-search-origin"><span>来源</span><select name="origin"><option value="" ${origin === "" ? "selected" : ""}>全部来源</option><option value="direct" ${origin === "direct" ? "selected" : ""}>直接提问</option><option value="organization" ${origin === "organization" ? "selected" : ""}>协作组织</option><option value="selection" ${origin === "selection" ? "selected" : ""}>正文划词</option><option value="wiki_entry" ${origin === "wiki_entry" ? "selected" : ""}>词条</option><option value="page" ${origin === "page" ? "selected" : ""}>页面</option></select></label><button class="qa-search-button" type="submit">${this.icon("search")}<span>搜索</span></button></form>${this.embedded ? this.identityActionHtml(bootstrap) : ""}</section>
        ${this.state.user ? this.composerHtml(composeOpen ? draft || {} : null, bootstrap, organizationSlug) : ""}
        ${choosingAnswerTarget ? `<aside class="qa-answer-target-banner"><div><strong>选择要回答的问题</strong><span>选中的正文将自动放入回答编辑框。</span></div><button type="button" data-qa-cancel-answer-draft>取消</button></aside>` : ""}
        <section class="qa-question-list" aria-live="polite">${items.length ? items.map((item) => this.questionRow(item, { answerPicker: choosingAnswerTarget, origin })).join("") : `<div class="qa-empty-state"><span>${this.icon("forum")}</span><h2>${query || origin ? "没有匹配的问题" : "还没有问题"}</h2><p>调整关键词或来源，或发起第一个可追踪的问题。</p></div>`}</section>
        ${this.pager(info, { q: query, order, tag, origin, ...(organizationSlug ? { organization: organizationSlug } : {}) }, "问题")}
      </section>`;
      if (composeOpen) this.root.querySelector("#qaComposer")?.removeAttribute("hidden");
      this.bindCommon(bootstrap);
      this.root.querySelector("#qaSearchForm")?.addEventListener("submit", (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const next = new URLSearchParams();
        if (String(form.get("q") || "").trim()) next.set("q", String(form.get("q")).trim());
        if (form.get("order") && form.get("order") !== "active") next.set("order", String(form.get("order")));
        if (form.get("origin")) next.set("origin", String(form.get("origin")));
        if (organizationSlug) next.set("organization", organizationSlug);
        location.hash = this.routeHref(next);
      });
      this.bindQuestionComposer(bootstrap, draft, organizationSlug);
      this.root.querySelector("[data-qa-cancel-answer-draft]")?.addEventListener("click", () => {
        clearDraft("answer");
        this.renderQuestions(params);
      });
    }

    bindQuestionComposer(bootstrap, draft, organizationSlug) {
      const form = this.root.querySelector("#qaQuestionForm");
      form?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const status = form.querySelector(".status-line");
        const values = new FormData(form);
        const payload = {
          title: String(values.get("title") || "").trim(),
          content: String(values.get("content") || "").trim(),
          tags: String(values.get("tags") || "").split(/[,，]/).map((item) => item.trim()).filter(Boolean),
          organization: organizationSlug,
          source: form.dataset.qaSourceCleared === "true" ? null : draft?.source || null,
          attachments: this.formAttachments(form),
        };
        status.textContent = "正在发布问题...";
        try {
          const result = await this.api("/api/community/qa/questions", { method: "POST", body: JSON.stringify(payload) });
          clearDraft("question");
          this.toast("问题已发布");
          location.hash = result.url || `#/questions/${encodeURIComponent(result.question?.id || "")}`;
        } catch (error) {
          status.textContent = error.message;
        }
      });
    }

    voteControls(type, item) {
      const vote = Number(item.viewer?.vote || 0);
      const canVote = Boolean(this.state.user && (item.permissions?.vote ?? true));
      const arrow = (direction) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${direction > 0 ? "m6 14 6-6 6 6" : "m6 10 6 6 6-6"}"/></svg>`;
      return `<aside class="qa-vote-column" aria-label="内容质量投票">
        <button class="qa-vote-action ${vote === 1 ? "active" : ""}" type="button" data-qa-vote data-object-type="${type}" data-object-id="${this.escape(item.id)}" data-vote-value="1" aria-pressed="${vote === 1}" aria-label="赞同" title="赞同" ${canVote ? "" : "disabled"}>${arrow(1)}</button>
        <strong data-qa-vote-score>${Number(item.voteCount || 0)}</strong>
        <button class="qa-vote-action ${vote === -1 ? "active" : ""}" type="button" data-qa-vote data-object-type="${type}" data-object-id="${this.escape(item.id)}" data-vote-value="-1" aria-pressed="${vote === -1}" aria-label="反对" title="反对" ${canVote ? "" : "disabled"}>${arrow(-1)}</button>
        ${item.accepted ? '<em title="已采纳" aria-label="已采纳">✓</em>' : ""}
      </aside>`;
    }

    engagementBar(type, item, question = item) {
      const viewer = item.viewer || {};
      const permissions = item.permissions || {};
      const helpful = (item.reactions || []).find((reaction) => reaction.reaction === "helpful") || {};
      const action = (attrs, icon, label, active = false, danger = false, variant = "") => `<button class="qa-object-action ${active ? "active" : ""} ${danger ? "danger" : ""} ${variant}" type="button" ${attrs}>${this.icon(icon)}<span>${label}</span></button>`;
      const items = [];
      if (this.state.user) {
        items.push(action(`data-qa-collection data-object-type="${type}" data-object-id="${this.escape(item.id)}" aria-pressed="${Boolean(viewer.collected)}"`, "bookmark", viewer.collected ? "已收藏" : "收藏", viewer.collected, false, "is-collection"));
        if (type === "question") items.push(action(`data-qa-follow data-object-type="question" data-object-id="${this.escape(item.id)}" aria-pressed="${Boolean(viewer.followed)}"`, "pulse", viewer.followed ? "已关注" : "关注", viewer.followed, false, "is-follow"));
        items.push(action(`data-qa-reaction="helpful" data-reaction-count="${Number(helpful.count || 0)}" data-object-type="${type}" data-object-id="${this.escape(item.id)}" aria-pressed="${Boolean(helpful.active)}"`, "review", `有帮助 ${Number(helpful.count || 0)}`, helpful.active, false, "is-helpful"));
      }
      items.push(action(`data-qa-history data-object-type="${type}" data-object-id="${this.escape(item.id)}" aria-expanded="false"`, "history", "修订记录"));
      if (permissions.edit) items.push(action(`data-qa-edit="${type}" data-object-id="${this.escape(item.id)}" aria-expanded="false"`, "edit", "编辑"));
      if (type === "question" && this.state.user && !permissions.edit && !item.closed) items.push(action(`data-qa-propose data-object-id="${this.escape(item.id)}"`, "edit", "建议修订"));
      if (type === "question" && permissions.invite) items.push(action(`data-qa-invite-toggle data-object-id="${this.escape(item.id)}"`, "members", "邀请回答"));
      if (type === "question" && permissions.close) items.push(action(`data-qa-question-state="${item.closed ? "open" : "closed"}" data-object-id="${this.escape(item.id)}"`, "permissions", item.closed ? "重新打开" : "关闭问题"));
      if (type === "answer" && permissions.accept) items.push(action(`data-qa-accept data-answer-id="${this.escape(item.id)}" data-question-id="${this.escape(question.id)}" data-accept-action="${item.accepted ? "remove" : "accept"}"`, "review", item.accepted ? "取消采纳" : "采纳回答", item.accepted));
      if (this.state.user) items.push(action(`data-qa-report data-object-type="${type}" data-object-id="${this.escape(item.id)}" aria-expanded="false"`, "forum", "举报"));
      if (permissions.delete) items.push(action(`data-qa-delete="${type}" data-object-id="${this.escape(item.id)}"`, "delete", "删除", false, true));
      if (type === "answer" && this.state.user) items.push(action(`data-qa-wiki-draft="${this.escape(item.id)}"`, "article", "整理为词条草稿", false, false, "is-wiki-draft"));
      return `<nav class="qa-object-actions" aria-label="内容操作">${items.join("")}</nav>`;
    }

    editForm(type, item) {
      const questionFields = type === "question" ? `<div class="qa-edit-meta"><label class="wikist-field"><span>标题</span><input class="wikist-input" name="title" minlength="6" maxlength="150" required value="${this.escape(item.title || "")}" /></label><label class="wikist-field"><span>标签</span><input class="wikist-input" name="tags" required value="${this.escape((item.tags || []).join(", "))}" /></label></div>` : "";
      const editorTools = type === "answer" ? this.answerEditorToolsHtml() : this.attachmentPicker();
      return `<form class="qa-inline-editor" data-qa-edit-form="${type}" data-object-id="${this.escape(item.id)}" hidden><header><div><span class="system-kicker">Edit Content</span><h3>编辑${type === "question" ? "问题" : "回答"}</h3></div><button class="qa-icon-button" type="button" data-qa-edit-cancel aria-label="收起编辑器">×</button></header>${questionFields}<label class="wikist-field"><span>正文</span><textarea class="wikist-input" name="content" rows="10" required>${this.escape(item.bodyMd || "")}</textarea></label><label class="wikist-field"><span>编辑摘要</span><input class="wikist-input" name="summary" maxlength="500" placeholder="说明本次修改" /></label>${editorTools}<footer><span class="status-line"></span>${this.clearActionHtml()}<button class="qa-secondary-action" type="button" data-qa-edit-cancel>取消</button><button class="qa-primary-action" type="submit">保存修改</button></footer></form>`;
    }

    reportForm(type, item) {
      if (!this.state.user) return "";
      return `<form class="qa-inline-editor qa-report-form" data-qa-report-form="${type}" data-object-id="${this.escape(item.id)}" hidden><header><div><span class="system-kicker">Community Review</span><h3>举报${type === "question" ? "问题" : "回答"}</h3></div><button class="qa-icon-button" type="button" data-qa-report-cancel aria-label="收起举报表单">×</button></header><div class="qa-report-fields"><label class="wikist-field"><span>举报原因</span><select class="wikist-input" name="reason" required><option value="spam">垃圾信息</option><option value="abuse">不当内容</option><option value="duplicate">重复内容</option><option value="incorrect">事实错误</option><option value="copyright">版权问题</option><option value="privacy">隐私问题</option><option value="other">其他</option></select></label><label class="wikist-field"><span>补充说明</span><textarea class="wikist-input" name="details" rows="4" maxlength="1000" placeholder="提供有助于审核的事实或来源"></textarea></label></div><footer><span class="status-line" aria-live="polite"></span><button class="qa-secondary-action" type="button" data-qa-report-cancel>取消</button><button class="qa-primary-action" type="submit">提交举报</button></footer></form>`;
    }

    revisionProposalForm(question) {
      if (!this.state.user || question.permissions?.edit || question.closed) return "";
      return `<form class="qa-inline-editor qa-revision-proposal" data-qa-revision-form data-object-id="${this.escape(question.id)}" hidden><header><div><span class="system-kicker">Community Revision</span><h3>建议修订</h3></div><p>提交后进入社区审阅队列，通过后才会替换当前内容。</p></header><div class="qa-revision-fields"><label class="wikist-field"><span>标题</span><input class="wikist-input" name="title" minlength="6" maxlength="150" required value="${this.escape(question.title || "")}" /></label><label class="wikist-field"><span>标签</span><input class="wikist-input" name="tags" required value="${this.escape((question.tags || []).join(", "))}" /></label></div><label class="wikist-field"><span>正文</span><textarea class="wikist-input" name="content" rows="12" required>${this.escape(question.bodyMd || "")}</textarea></label><label class="wikist-field"><span>修订说明</span><input class="wikist-input" name="summary" maxlength="500" required placeholder="说明修改依据、来源或需要解决的问题" /></label><footer><span class="status-line" aria-live="polite"></span>${this.clearActionHtml()}<button class="qa-secondary-action" type="button" data-qa-propose-cancel>取消</button><button class="qa-primary-action" type="submit">提交审阅</button></footer></form>`;
    }

    invitationPanel(question) {
      if (!this.state.user) return "";
      const invitations = question.invitations?.items || [];
      const pending = invitations.find((item) => item.status === "pending" && Number(item.invitee?.id || 0) === Number(this.state.user.id || 0));
      const statusLabels = { pending: "等待回应", accepted: "已接受", dismissed: "已忽略" };
      const manager = question.permissions?.invite
        ? `<section class="qa-invitation-manager" data-qa-invitation-manager hidden><header><div class="qa-invitation-heading"><span class="qa-invitation-icon">${this.icon("members")}</span><div><span class="system-kicker">Invite Experts</span><h3>邀请回答</h3><p>邀请熟悉该主题的成员参与回答。</p></div></div><button class="qa-icon-button" type="button" data-qa-invite-close aria-label="收起邀请面板">×</button></header><form data-qa-invite-form><div class="qa-invitation-fields"><label class="wikist-field qa-invite-user-field"><span>社区成员</span><input class="wikist-input" name="username" type="search" autocomplete="off" placeholder="搜索用户名或显示名称" required /><input name="userId" type="hidden" /><div class="qa-invite-suggestions" data-qa-invite-suggestions hidden></div></label><label class="wikist-field"><span>附言</span><textarea class="wikist-input" name="message" rows="4" maxlength="1000" placeholder="说明希望对方回答的重点（可选）"></textarea></label></div><footer><span class="status-line" aria-live="polite"></span><button class="qa-primary-action" type="submit">发送邀请</button></footer></form>${invitations.length ? `<div class="qa-invitation-list"><header><h4>邀请记录</h4><span>${invitations.length} 人</span></header>${invitations.map((item) => `<article>${this.avatar(item.invitee || {}, "small")}<span><strong>${this.escape(item.invitee?.displayName || item.invitee?.username || "社区成员")}</strong><small>@${this.escape(item.invitee?.username || "user")} · ${this.escape(statusLabels[item.status] || item.status)}</small></span><time>${this.formatDate(item.createdAt)}</time></article>`).join("")}</div>` : ""}</section>`
        : "";
      const notice = pending
        ? `<aside class="qa-invitation-notice" data-qa-invitation-notice><span>${this.icon("members")}</span><div><strong>你已受邀回答这个问题</strong><small>${this.escape(pending.message || `${pending.inviter?.displayName || pending.inviter?.username || "提问者"} 邀请你分享解答。`)}</small></div><button type="button" data-qa-invite-answer>开始回答</button><button type="button" data-qa-invite-dismiss="${this.escape(pending.id)}">忽略</button></aside>`
        : "";
      return notice || manager ? `<div class="qa-invitation-area">${notice}${manager}</div>` : "";
    }

    attachmentPicker(compact = false) {
      return `<div class="qa-attachment-picker ${compact ? "is-inline-action" : ""}"><label><input type="file" data-qa-attachment-input multiple accept="image/*,.pdf,.txt,.md,.zip" /><span>${this.icon("article")}添加附件</span></label><div data-qa-attachment-list></div></div>`;
    }

    answerEditorToolsHtml() {
      return `<div class="qa-answer-editor-tools">${this.referencePickerHtml()}${this.attachmentPicker(true)}</div>`;
    }

    referenceToken(reference = {}) {
      const type = reference.type === "page" ? "wiki_entry" : String(reference.type || "wiki_entry").toLowerCase();
      const revision = String(reference.revision || "").trim();
      const rawId = `${String(reference.id || "").trim()}${type === "revision" && revision ? `@${revision}` : ""}`;
      const id = rawId.replace(/[|{}\n\r]/g, " ").trim();
      const label = String(reference.label || reference.displayName || reference.id || "").replace(/[|{}\n\r]/g, " ").trim() || id;
      return `{{ref:${type}|${id}|${label}}}`;
    }

    referencePickerHtml() {
      return `<div class="qa-reference-control"><button class="qa-reference-trigger" type="button" data-qa-reference-toggle aria-expanded="false">${this.icon("network")}<span>引用知识</span></button><section class="qa-reference-picker" data-qa-reference-picker hidden><header><div><span class="system-kicker">Knowledge Reference</span><strong>插入知识引用</strong></div><button class="qa-icon-button" type="button" data-qa-reference-close aria-label="关闭引用选择器">×</button></header><div class="qa-reference-fields"><label class="wikist-field"><span>类型</span><select class="wikist-input" data-qa-reference-type><option value="wiki_entry">词条</option><option value="revision">词条修订</option><option value="question">问题</option><option value="answer">回答</option><option value="organization">协作组织</option><option value="user">用户</option></select></label><label class="wikist-field qa-reference-search-field"><span>查找</span><input class="wikist-input" data-qa-reference-search type="search" autocomplete="off" placeholder="搜索标题或标识" /></label><label class="wikist-field" data-qa-reference-revision hidden><span>修订版本</span><input class="wikist-input" data-qa-reference-revision-input placeholder="版本标识" /></label></div><div class="qa-reference-results" data-qa-reference-results><p class="muted-line">搜索并选择要引用的内容。</p></div></section></div>`;
    }

    bindReferencePickers(signal) {
      this.root.querySelectorAll("[data-qa-reference-picker]").forEach((panel) => {
        const type = panel.querySelector("[data-qa-reference-type]");
        const search = panel.querySelector("[data-qa-reference-search]");
        const results = panel.querySelector("[data-qa-reference-results]");
        const revisionField = panel.querySelector("[data-qa-reference-revision]");
        let timer = 0;
        let requestId = 0;
        const load = () => {
          window.clearTimeout(timer);
          const query = String(search?.value || "").trim();
          if (!query) {
            if (results) results.innerHTML = '<p class="muted-line">搜索并选择要引用的内容。</p>';
            return;
          }
          const current = ++requestId;
          if (results) results.innerHTML = '<p class="muted-line">正在查找知识对象...</p>';
          timer = window.setTimeout(async () => {
            const payload = await this.api(`/api/messaging/objects/suggest?type=${encodeURIComponent(type?.value || "wiki_entry")}&q=${encodeURIComponent(query)}&limit=12`).catch(() => ({ items: [] }));
            if (current !== requestId || String(search?.value || "").trim() !== query || !results) return;
            const items = payload.items || [];
            results.innerHTML = items.length
              ? items.map((item) => `<button type="button" data-qa-reference-item="${this.escape(encodeURIComponent(JSON.stringify(item)))}"><span class="qa-reference-result-icon">${this.icon(item.type === "user" ? "members" : "network")}</span><span><strong>${this.escape(item.label || item.displayName || item.id || "知识对象")}</strong><small>${this.escape(item.summary || item.id || "")}</small></span><em>引用</em></button>`).join("")
              : '<p class="muted-line">没有找到匹配结果。</p>';
          }, 180);
        };
        type?.addEventListener("change", () => {
          revisionField?.toggleAttribute("hidden", type.value !== "revision");
          load();
        }, { signal });
        search?.addEventListener("input", load, { signal });
        signal.addEventListener("abort", () => window.clearTimeout(timer), { once: true });
      });
    }

    formAttachments(form) {
      try { return JSON.parse(form.dataset.qaAttachments || "[]"); } catch (_error) { return []; }
    }

    clearWritingForm(form) {
      if (!form) return;
      form.querySelectorAll("input, textarea").forEach((control) => {
        const type = String(control.type || "").toLowerCase();
        if (type === "hidden" && !["replyToCommentId", "userId"].includes(control.name)) return;
        if (type === "checkbox" || type === "radio") control.checked = false;
        else control.value = "";
        control.dispatchEvent(new Event("input", { bubbles: true }));
      });
      form.querySelectorAll("[data-qa-attachment-list]").forEach((list) => { list.innerHTML = ""; });
      delete form.dataset.qaAttachments;
      const replyContext = form.querySelector(".qa-comment-reply-context");
      if (replyContext) replyContext.hidden = true;
      const suggestions = form.querySelector("[data-qa-invite-suggestions]");
      if (suggestions) {
        suggestions.hidden = true;
        suggestions.innerHTML = "";
      }
      const referenceResults = form.querySelector("[data-qa-reference-results]");
      if (referenceResults) referenceResults.innerHTML = '<p class="muted-line">搜索并选择要引用的内容。</p>';
      const status = form.querySelector(".status-line");
      if (status) status.textContent = "";
      if (form.id === "qaQuestionForm") {
        form.dataset.qaSourceCleared = "true";
        form.closest(".qa-composer")?.querySelector(".qa-source-context")?.remove();
        clearDraft("question");
      }
      if (form.id === "qaAnswerForm") clearDraft("answer");
      form.querySelector("input:not([type='hidden']), textarea")?.focus();
      this.toast("输入已清空");
    }

    bindAttachmentInputs() {
      this.root.querySelectorAll("[data-qa-attachment-input]").forEach((input) => input.addEventListener("change", async () => {
        const form = input.closest("form");
        const list = form?.querySelector("[data-qa-attachment-list]");
        const textarea = form?.querySelector("textarea[name='content']");
        if (!form || !list || !input.files?.length) return;
        const ids = this.formAttachments(form);
        input.disabled = true;
        for (const file of Array.from(input.files).slice(0, Math.max(0, 10 - ids.length))) {
          const body = new FormData();
          body.append("file", file);
          try {
            const result = await this.api("/api/community/qa/attachments", { method: "POST", body });
            const attachment = result.attachment || result;
            ids.push(attachment.id);
            const markdown = String(attachment.mimeType || "").startsWith("image/")
              ? `![${attachment.name}](${attachment.url})`
              : `[${attachment.name}](${attachment.url})`;
            if (textarea) textarea.value = `${textarea.value.trimEnd()}${textarea.value.trim() ? "\n\n" : ""}${markdown}`;
            list.insertAdjacentHTML("beforeend", `<span>${this.icon("article")}<em>${this.escape(attachment.name)}</em></span>`);
          } catch (error) {
            await this.alert("附件上传失败", error.message, "error");
          }
        }
        form.dataset.qaAttachments = JSON.stringify(ids);
        input.value = "";
        input.disabled = false;
      }));
    }

    async confirmAction(title, text, confirmText = "确认") {
      return this.confirm({
        title,
        text,
        icon: "warning",
        confirmText,
        cancelText: "取消",
        danger: /删除|关闭/.test(title),
      });
    }

    relationCard(relation) {
      const object = relation.object || {};
      const labels = { wiki_entry: "词条", question: "问题", answer: "回答", organization: "组织", user: "用户", revision: "修订", selection: "划词", chat_message: "消息" };
      return `<a class="qa-relation-card" href="${this.escape(object.url || "#/knowledge")}"><span>${this.escape(labels[object.type] || object.type || "知识对象")}</span><strong>${this.escape(object.title || object.key)}</strong><small>${this.escape(object.summary || relation.predicate || "查看关联内容")}</small></a>`;
    }

    commentList(comments = [], options = {}) {
      const pagination = options.pagination || { page: 1, pages: 1, total: comments.length };
      if (!comments.length && !pagination.total) return "";
      const rows = comments.map((comment) => {
        const replyUsername = String(comment.replyUser?.username || "");
        const bodyStartsWithMention = replyUsername && String(comment.bodyMd || "").trimStart().toLocaleLowerCase().startsWith(`@${replyUsername}`.toLocaleLowerCase());
        const replyMention = replyUsername && !bodyStartsWithMention
          ? `<a class="qa-comment-mention" href="#/user/${encodeURIComponent(replyUsername)}">@${this.escape(replyUsername)}</a>`
          : "";
        return `<article id="comment-${this.escape(comment.id)}"><div>${this.authorHtml(comment.author, comment.createdAt)}</div><div class="qa-comment-body">${replyMention}${this.bodyHtml(comment)}<footer>${this.state.user ? `<button type="button" data-qa-comment-reply="${this.escape(comment.id)}" data-reply-username="${this.escape(comment.author?.username || "")}" data-target-type="${this.escape(options.objectType || comment.objectType || "")}" data-target-id="${this.escape(options.objectId || comment.objectId || "")}">回复</button>` : ""}${comment.permissions?.edit ? `<button type="button" data-qa-comment-edit="${this.escape(comment.id)}" data-comment-body="${this.escape(comment.bodyMd || "")}">编辑</button>` : ""}${comment.permissions?.delete ? `<button class="danger" type="button" data-qa-delete="comment" data-object-id="${this.escape(comment.id)}">删除</button>` : ""}</footer></div></article>`;
      }).join("");
      const more = Number(pagination.pages || 1) > Number(pagination.page || 1)
        ? `<button class="qa-comments-more" type="button" data-qa-load-comments data-object-type="${this.escape(options.objectType || "")}" data-object-id="${this.escape(options.objectId || "")}" data-comment-page="${Number(pagination.page || 1) + 1}">查看更多评论 · 共 ${Number(pagination.total || comments.length)} 条</button>`
        : `<span class="qa-comments-total">共 ${Number(pagination.total || comments.length)} 条</span>`;
      return `<div class="qa-comments" data-comments-for="${this.escape(options.objectType || "")}:${this.escape(options.objectId || "")}">${rows}${more}</div>`;
    }

    commentForm(objectId, objectType) {
      if (!this.state.user) return "";
      return `<details class="qa-comment-composer" data-qa-comment-shell="${this.escape(objectType)}:${this.escape(objectId)}"><summary>添加评论</summary><form data-qa-comment="${this.escape(objectId)}" data-qa-object-type="${this.escape(objectType)}"><input type="hidden" name="replyToCommentId" /><div class="qa-comment-reply-context" hidden><span></span><button type="button" data-qa-reply-cancel aria-label="取消回复">×</button></div><textarea class="wikist-input" name="content" rows="3" minlength="2" maxlength="2000" required placeholder="补充事实、来源或需要澄清的内容"></textarea><div class="qa-answer-editor-tools">${this.attachmentPicker(true)}</div><footer class="qa-comment-composer-actions"><span class="status-line" aria-live="polite"></span><div class="qa-form-actions">${this.clearActionHtml()}<button class="qa-primary-action" type="submit">发布评论</button></div></footer></form></details>`;
    }

    answerCard(answer, question) {
      const attributes = this.selectionAttributes({ type: "answer", id: answer.id, label: `回答 · ${question.title}`, url: `#/questions/${question.id}?answer=${answer.id}` });
      return `<article class="qa-answer-card ${answer.accepted ? "is-accepted" : ""}" id="answer-${this.escape(answer.id)}">${this.voteControls("answer", answer)}<div class="qa-answer-main"><header>${this.authorHtml(answer.author, answer.updatedAt || answer.createdAt)}${answer.accepted ? '<span class="qa-accepted-label">已采纳</span>' : ""}</header><article class="article-body qa-prose" ${attributes}>${this.bodyHtml(answer)}</article>${this.engagementBar("answer", answer, question)}${this.editForm("answer", answer)}${this.reportForm("answer", answer)}<section class="qa-history-panel" data-qa-history-panel="answer:${this.escape(answer.id)}" hidden></section>${this.commentList(answer.comments || [], { objectType: "answer", objectId: answer.id, pagination: answer.commentsPagination })}${Number(answer.commentCount || 0) && !(answer.comments || []).length ? `<button class="qa-comments-more" type="button" data-qa-load-comments data-object-type="answer" data-object-id="${this.escape(answer.id)}" data-comment-page="1">查看 ${Number(answer.commentCount)} 条评论</button>` : ""}${this.commentForm(answer.id, "answer")}</div></article>`;
    }

    async renderQuestion(questionId, params = new URLSearchParams()) {
      this.setTitle("社区问题");
      this.renderToc([]);
      const answerPage = Math.max(1, Number(params.get("answerPage")) || 1);
      const [bootstrap, payload] = await Promise.all([this.loadBootstrap(), this.api(`/api/community/qa/questions/${encodeURIComponent(questionId)}?answerPage=${answerPage}`)]);
      const question = payload.question || {};
      const answers = payload.answers || { items: [], page: answerPage, total: 0, pages: 1 };
      const relations = Array.isArray(payload.relations) ? payload.relations : payload.relations?.items || [];
      const attributes = this.selectionAttributes({ type: "question", id: question.id, label: question.title, url: `#/questions/${question.id}` });
      let draft = readDraft("answer");
      if (draft && !draft.questionId && params.get("useDraft") === "1") {
        draft = { ...draft, questionId: String(question.id) };
        writeDraft(draft);
      }
      const answerContent = draft?.questionId === String(question.id) ? draft.content || "" : "";
      this.setTitle(question.title || "社区问题");
      this.root.innerHTML = `<section class="community-qa-shell qa-detail-shell">
        <nav class="qa-breadcrumb"><a href="#/questions">问答与讨论</a><span>/</span><span>问题</span></nav>
        ${this.communityNav("questions")}${this.serviceStateHtml(bootstrap, payload)}
        <article class="qa-question-detail"><header><div><div class="qa-tag-list">${(question.tags || []).map((tag) => `<a href="#/questions?tag=${encodeURIComponent(tag)}">${this.escape(tag)}</a>`).join("")}</div>${this.questionOriginsHtml(question)}<h1>${this.escape(question.title || `问题 #${question.id}`)}</h1><div class="qa-detail-meta"><span>${Number(question.viewCount || 0)} 次浏览</span><span>${Number(question.answerCount || answers.total || 0)} 个回答</span><span data-qa-follower-count>${Number(question.followerCount || 0)} 人关注</span>${question.closed ? '<span class="qa-closed-label">已关闭</span>' : ""}</div></div>${this.authorHtml(question.author, question.updatedAt || question.createdAt)}</header><div class="qa-question-content">${this.voteControls("question", question)}<div class="qa-question-main"><article class="article-body qa-prose" ${attributes}>${this.bodyHtml(question)}</article>${this.engagementBar("question", question)}${this.invitationPanel(question)}${this.editForm("question", question)}${this.revisionProposalForm(question)}${this.reportForm("question", question)}<section class="qa-history-panel" data-qa-history-panel="question:${this.escape(question.id)}" hidden></section>${this.commentList(question.comments || [], { objectType: "question", objectId: question.id, pagination: question.commentsPagination })}${this.commentForm(question.id, "question")}</div></div></article>
        ${relations.length ? `<section class="qa-relations"><header><div><span class="system-kicker">Knowledge Relations</span><h2>知识关联</h2></div><span>${relations.length} 项</span></header><div>${relations.map((relation) => this.relationCard(relation)).join("")}</div></section>` : ""}
        <section class="qa-answers"><header><div><span class="system-kicker">Community Answers</span><h2>${Number(answers.total || answers.items?.length || 0)} 个回答</h2></div></header><div class="qa-answer-list">${(answers.items || []).length ? answers.items.map((answer) => this.answerCard(answer, question)).join("") : '<div class="qa-empty-state compact"><h2>等待第一个回答</h2><p>给出可验证的推导、例子或来源。</p></div>'}</div>${this.answerPager(answers, question.id)}</section>
        ${this.answerComposerHtml(question, bootstrap, answerContent)}
      </section>`;
      this.bindCommon(bootstrap);
      this.bindDetail(question, bootstrap, draft);
      this.typeset();
      const answerId = params.get("answer");
      if (answerId) this.root.querySelector(`#answer-${global.CSS?.escape ? CSS.escape(answerId) : answerId}`)?.scrollIntoView({ block: "center" });
    }

    answerPager(payload, questionId) {
      const info = pageInfo(payload, 1, 20);
      if (!info.total || info.pages <= 1) return info.total ? `<footer class="qa-pager is-single"><span>共 ${info.total} 个回答</span></footer>` : "";
      const link = (page) => `#/questions/${encodeURIComponent(questionId)}${page > 1 ? `?answerPage=${page}` : ""}`;
      return `<nav class="qa-pager" aria-label="回答分页"><a class="${info.page <= 1 ? "is-disabled" : ""}" href="${link(Math.max(1, info.page - 1))}">上一页</a><span>第 ${info.page} / ${info.pages} 页 · 共 ${info.total} 个回答</span><a class="${info.page >= info.pages ? "is-disabled" : ""}" href="${link(Math.min(info.pages, info.page + 1))}">下一页</a></nav>`;
    }

    answerComposerHtml(question, bootstrap, content = "") {
      if (!this.state.user) return `<aside class="qa-answer-gate"><strong>参与回答</strong><span>登录 Passport 后可以回答、评论与接收互动通知。</span><a href="/passport?mode=login">登录</a></aside>`;
      if (!bootstrap.enabled) return "";
      return `<section class="qa-answer-composer"><header><div><span class="system-kicker">Your Answer</span><h2>撰写回答</h2></div></header><form id="qaAnswerForm" data-question-id="${this.escape(question.id)}"><textarea class="wikist-input" name="content" rows="12" minlength="6" maxlength="65535" required placeholder="给出完整推导、例子和可核验来源；支持 [[词条]] 与结构化引用。">${this.escape(content)}</textarea>${this.answerEditorToolsHtml()}<footer class="qa-answer-composer-actions"><p class="status-line" aria-live="polite"></p><div class="qa-form-actions">${this.clearActionHtml()}<button class="qa-primary-action" type="submit">发布回答</button></div></footer></form></section>`;
    }

    async loadHistory(type, id, panel) {
      panel.hidden = false;
      panel.innerHTML = '<p class="qa-panel-loading">正在读取修订记录...</p>';
      try {
        const payload = await this.api(`/api/community/qa/objects/${encodeURIComponent(type)}/${encodeURIComponent(id)}/revisions?page=1&limit=20`);
        const items = payload.items || [];
        panel.innerHTML = `<header><div><span class="system-kicker">Revision History</span><h3>修订记录</h3></div><button type="button" data-qa-history-close aria-label="关闭">×</button></header><div class="qa-revision-list">${items.length ? items.map((item, index) => `<article><span>v${Number(item.number || 0)}</span><div><strong>${this.escape(item.summary || "内容修订")}</strong><small>${this.escape(item.editor?.displayName || item.editor?.username || "社区成员")} · ${this.formatDate(item.createdAt)}</small></div>${items[index + 1] ? `<button type="button" data-qa-diff data-object-type="${type}" data-object-id="${this.escape(id)}" data-from="${this.escape(items[index + 1].id)}" data-to="${this.escape(item.id)}">比较</button>` : ""}</article>`).join("") : '<p class="muted-line">还没有修订记录。</p>'}</div><div class="qa-diff-view" data-qa-diff-view hidden></div>`;
      } catch (error) {
        panel.innerHTML = `<p class="status-line">${this.escape(error.message)}</p>`;
      }
    }

    async loadComments(type, id, page, button) {
      button.disabled = true;
      try {
        const payload = await this.api(`/api/community/qa/objects/${encodeURIComponent(type)}/${encodeURIComponent(id)}/comments?page=${Math.max(1, page)}&limit=12`);
        const existing = this.root.querySelector(`[data-comments-for="${type}:${global.CSS?.escape ? CSS.escape(String(id)) : String(id)}"]`);
        const shell = document.createElement("template");
        shell.innerHTML = this.commentList(payload.items || [], { objectType: type, objectId: id, pagination: payload });
        if (existing && page > 1) {
          existing.querySelector(".qa-comments-more, .qa-comments-total")?.remove();
          const incoming = shell.content.querySelector(".qa-comments");
          Array.from(incoming?.children || []).forEach((child) => existing.append(child));
        } else if (existing) {
          existing.replaceWith(shell.content);
        } else {
          button.replaceWith(shell.content);
        }
      } catch (error) {
        button.disabled = false;
        await this.alert("评论加载失败", error.message, "error");
      }
    }

    bindDetail(question, bootstrap, draft) {
      this.releaseDetailBindings();
      this.detailAbort = new AbortController();
      this.root.__wikistCommunityQaDetailAbort = this.detailAbort;
      const signal = this.detailAbort.signal;
      signal.addEventListener("abort", () => {
        if (this.root?.__wikistCommunityQaDetailAbort === this.detailAbort) delete this.root.__wikistCommunityQaDetailAbort;
      }, { once: true });
      const refresh = () => this.renderQuestion(String(question.id), parseValue(this.currentValue).params);
      const setActionPending = (button, pending) => {
        if (!button) return;
        button.toggleAttribute("aria-busy", pending);
        if (pending) button.dataset.pending = "true";
        else delete button.dataset.pending;
      };
      const toggleActionPanel = (button, panel) => {
        if (!panel) return false;
        const opening = panel.hasAttribute("hidden");
        panel.toggleAttribute("hidden", !opening);
        button?.classList.toggle("active", opening);
        button?.setAttribute("aria-expanded", String(opening));
        return opening;
      };
      const closeActionPanel = (button, panel) => {
        if (!panel) return;
        panel.setAttribute("hidden", "");
        button?.classList.remove("active");
        button?.setAttribute("aria-expanded", "false");
      };
      const inviteInput = this.root.querySelector("[data-qa-invite-form] input[name='username']");
      this.bindReferencePickers(signal);
      let inviteSearchTimer = 0;
      let inviteSearchRequest = 0;
      inviteInput?.addEventListener("input", () => {
        const form = inviteInput.closest("form");
        const suggestions = form?.querySelector("[data-qa-invite-suggestions]");
        if (!form || !suggestions) return;
        form.elements.userId.value = "";
        window.clearTimeout(inviteSearchTimer);
        const query = inviteInput.value.trim();
        if (!query) {
          suggestions.hidden = true;
          suggestions.innerHTML = "";
          return;
        }
        const requestId = ++inviteSearchRequest;
        suggestions.hidden = false;
        suggestions.innerHTML = '<p class="muted-line">正在查找成员...</p>';
        inviteSearchTimer = window.setTimeout(async () => {
          const payload = await this.api(`/api/messaging/users/suggest?q=${encodeURIComponent(query)}&limit=8`).catch(() => ({ items: [] }));
          if (requestId !== inviteSearchRequest || inviteInput.value.trim() !== query) return;
          const items = (payload.items || []).filter((item) => Number(item.id || 0) !== Number(this.state.user?.id || 0));
          suggestions.innerHTML = items.length
            ? items.map((item) => `<button type="button" data-qa-invite-user data-user-id="${Number(item.id || 0)}" data-username="${this.escape(item.username || "")}">${this.avatar(item, "small")}<span><strong>${this.escape(item.displayName || item.username || "社区成员")}</strong><small>@${this.escape(item.username || "user")}</small></span><em>选择</em></button>`).join("")
            : '<p class="muted-line">没有匹配的可用成员。</p>';
        }, 160);
      }, { signal });
      this.root.querySelector("#qaAnswerForm")?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const status = form.querySelector(".status-line");
        const content = String(new FormData(form).get("content") || "").trim();
        status.textContent = "正在发布回答...";
        try {
          const result = await this.api(`/api/community/qa/questions/${encodeURIComponent(question.id)}/answers`, { method: "POST", body: JSON.stringify({ content, attachments: this.formAttachments(form) }) });
          if (draft?.kind === "answer" && draft.questionId === String(question.id) && draft.selection?.id) {
            await this.api(`/api/selections/${encodeURIComponent(draft.selection.id)}/activities`, { method: "POST", body: JSON.stringify({ activityType: "quote", targetType: "answer", targetId: String(result.answer?.id || question.id), targetLabel: question.title }) }).catch(() => null);
          }
          clearDraft("answer");
          this.toast("回答已发布");
          await this.renderQuestion(String(question.id), new URLSearchParams());
        } catch (error) {
          status.textContent = error.message;
        }
      }, { signal });
      this.root.addEventListener("submit", async (event) => {
        const inviteForm = event.target.closest("[data-qa-invite-form]");
        if (inviteForm) {
          event.preventDefault();
          const values = new FormData(inviteForm);
          const status = inviteForm.querySelector(".status-line");
          const userId = String(values.get("userId") || "").trim();
          const username = String(values.get("username") || "").trim();
          if (!userId && !username) {
            status.textContent = "请选择要邀请的社区成员。";
            return;
          }
          status.textContent = "正在发送邀请...";
          try {
            await this.api(`/api/community/qa/questions/${encodeURIComponent(question.id)}/invitations`, { method: "POST", body: JSON.stringify({ userId: userId || undefined, username: userId ? undefined : username, message: String(values.get("message") || "").trim() }) });
            this.toast("邀请已发送");
            await refresh();
          } catch (error) {
            status.textContent = error.message;
          }
          return;
        }
        const revisionForm = event.target.closest("[data-qa-revision-form]");
        if (revisionForm) {
          event.preventDefault();
          const values = new FormData(revisionForm);
          const status = revisionForm.querySelector(".status-line");
          status.textContent = "正在提交审阅...";
          try {
            await this.api(`/api/community/qa/questions/${encodeURIComponent(question.id)}/revisions`, { method: "POST", body: JSON.stringify({ title: String(values.get("title") || "").trim(), content: String(values.get("content") || "").trim(), tags: String(values.get("tags") || "").split(/[,，]/).map((item) => item.trim()).filter(Boolean), summary: String(values.get("summary") || "").trim() }) });
            this.toast("修订建议已进入审阅队列");
            revisionForm.hidden = true;
          } catch (error) {
            status.textContent = error.message;
          }
          return;
        }
        const editor = event.target.closest("[data-qa-edit-form]");
        if (editor) {
          event.preventDefault();
          const type = editor.dataset.qaEditForm;
          const values = new FormData(editor);
          const status = editor.querySelector(".status-line");
          status.textContent = "正在保存...";
          const payload = { content: String(values.get("content") || "").trim(), summary: String(values.get("summary") || "").trim(), attachments: this.formAttachments(editor) };
          if (type === "question") {
            payload.title = String(values.get("title") || "").trim();
            payload.tags = String(values.get("tags") || "").split(/[,，]/).map((item) => item.trim()).filter(Boolean);
          }
          try {
            await this.api(`/api/community/qa/${type === "question" ? "questions" : "answers"}/${encodeURIComponent(editor.dataset.objectId)}`, { method: "PUT", body: JSON.stringify(payload) });
            this.toast("内容已更新");
            await this.renderQuestion(String(question.id), new URLSearchParams());
          } catch (error) {
            status.textContent = error.message;
          }
          return;
        }
        const reportForm = event.target.closest("[data-qa-report-form]");
        if (reportForm) {
          event.preventDefault();
          const values = new FormData(reportForm);
          const status = reportForm.querySelector(".status-line");
          const submit = reportForm.querySelector('[type="submit"]');
          setActionPending(submit, true);
          status.textContent = "正在提交举报...";
          try {
            await this.api(`/api/community/qa/objects/${encodeURIComponent(reportForm.dataset.qaReportForm)}/${encodeURIComponent(reportForm.dataset.objectId)}/report`, { method: "POST", body: JSON.stringify({ reason: String(values.get("reason") || "other"), details: String(values.get("details") || "").trim() }) });
            this.toast("举报已进入审核队列");
            reportForm.reset();
            reportForm.hidden = true;
            this.root.querySelector(`[data-qa-report][data-object-type="${reportForm.dataset.qaReportForm}"][data-object-id="${reportForm.dataset.objectId}"]`)?.classList.remove("active");
          } catch (error) {
            status.textContent = error.message;
          } finally {
            setActionPending(submit, false);
          }
          return;
        }
        const form = event.target.closest("[data-qa-comment]");
        if (!form) return;
        event.preventDefault();
        const status = form.querySelector(".status-line");
        status.textContent = "正在发布评论...";
        try {
          const values = new FormData(form);
          await this.api(`/api/community/qa/objects/${encodeURIComponent(form.dataset.qaComment)}/comments`, { method: "POST", body: JSON.stringify({ content: String(values.get("content") || "").trim(), objectType: form.dataset.qaObjectType || "", replyToCommentId: String(values.get("replyToCommentId") || ""), attachments: this.formAttachments(form) }) });
          this.toast("评论已发布");
          await this.renderQuestion(String(question.id), new URLSearchParams());
        } catch (error) {
          status.textContent = error.message;
        }
      }, { signal });
      this.root.addEventListener("click", async (event) => {
        const target = event.target.closest("button, a");
        if (!target || !this.root.contains(target)) return;

        const fail = async (title, error) => {
          target.disabled = false;
          await this.alert(title, error.message, "error");
        };

        if (target.matches("[data-qa-wiki-draft]")) {
          const targetSlug = await this.prompt({ title: "整理为 Wiki 内容", text: "填写目标词条 slug；留空将创建新词条。", placeholder: "例如 group-theory", confirmText: "生成草稿" });
          if (targetSlug === null) return;
          target.disabled = true;
          try {
            const result = await this.api(`/api/community/qa/questions/${encodeURIComponent(question.id)}/answers/${encodeURIComponent(target.dataset.qaWikiDraft)}/wiki-draft`, { method: "POST", body: JSON.stringify({ targetSlug }) });
            sessionStorage.setItem(WIKI_DRAFT_KEY, JSON.stringify({ ...result, createdAt: Date.now() }));
            location.hash = result.editUrl || "#/new";
          } catch (error) {
            await fail("草稿生成失败", error);
          }
          return;
        }

        if (target.matches("[data-qa-invite-toggle]")) {
          const panel = this.root.querySelector("[data-qa-invitation-manager]");
          if (panel && toggleActionPanel(target, panel)) {
              panel.querySelector("input[name='username']")?.focus();
              panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
          }
          return;
        }
        if (target.matches("[data-qa-invite-close]")) {
          const panel = target.closest("[data-qa-invitation-manager]");
          if (panel) closeActionPanel(this.root.querySelector("[data-qa-invite-toggle]"), panel);
          return;
        }
        if (target.matches("[data-qa-invite-user]")) {
          const form = target.closest("[data-qa-invite-form]");
          if (!form) return;
          form.elements.userId.value = target.dataset.userId || "";
          form.elements.username.value = target.dataset.username || "";
          const suggestions = form.querySelector("[data-qa-invite-suggestions]");
          if (suggestions) suggestions.hidden = true;
          form.elements.message?.focus();
          return;
        }
        if (target.matches("[data-qa-invite-answer]")) {
          const invitation = this.root.querySelector("[data-qa-invite-dismiss]")?.dataset.qaInviteDismiss || "";
          if (invitation) await this.api(`/api/community/qa/invitations/${encodeURIComponent(invitation)}`, { method: "PUT", body: JSON.stringify({ status: "accepted" }) }).catch(() => null);
          target.closest("[data-qa-invitation-notice]")?.remove();
          const form = this.root.querySelector("#qaAnswerForm");
          form?.scrollIntoView({ behavior: "smooth", block: "center" });
          form?.querySelector("textarea")?.focus();
          return;
        }
        if (target.matches("[data-qa-invite-dismiss]")) {
          target.disabled = true;
          try {
            await this.api(`/api/community/qa/invitations/${encodeURIComponent(target.dataset.qaInviteDismiss)}`, { method: "PUT", body: JSON.stringify({ status: "dismissed" }) });
            target.closest("[data-qa-invitation-notice]")?.remove();
            this.toast("已忽略邀请");
          } catch (error) {
            await fail("处理邀请失败", error);
          }
          return;
        }

        if (target.matches("[data-qa-reference-toggle]")) {
          const panel = target.closest(".qa-reference-control")?.querySelector("[data-qa-reference-picker]");
          if (panel && toggleActionPanel(target, panel)) panel.querySelector("[data-qa-reference-search]")?.focus();
          return;
        }
        if (target.matches("[data-qa-reference-close]")) {
          const control = target.closest(".qa-reference-control");
          closeActionPanel(control?.querySelector("[data-qa-reference-toggle]"), control?.querySelector("[data-qa-reference-picker]"));
          return;
        }
        if (target.matches("[data-qa-reference-item]")) {
          const control = target.closest(".qa-reference-control");
          const form = target.closest("form");
          const textarea = form?.querySelector("textarea[name='content']");
          if (!control || !textarea) return;
          let item;
          try { item = JSON.parse(decodeURIComponent(target.dataset.qaReferenceItem || "")); } catch (_error) { return; }
          if (item.type === "revision") {
            const revision = String(control.querySelector("[data-qa-reference-revision-input]")?.value || "").trim();
            if (!revision) {
              this.toast("请先填写修订版本标识");
              control.querySelector("[data-qa-reference-revision-input]")?.focus();
              return;
            }
            item.revision = revision;
          }
          const token = this.referenceToken(item);
          const start = Number.isInteger(textarea.selectionStart) ? textarea.selectionStart : textarea.value.length;
          const end = Number.isInteger(textarea.selectionEnd) ? textarea.selectionEnd : start;
          const prefix = start > 0 && !/\s/.test(textarea.value[start - 1]) ? " " : "";
          const suffix = end < textarea.value.length && !/\s/.test(textarea.value[end]) ? " " : "";
          textarea.setRangeText(`${prefix}${token}${suffix}`, start, end, "end");
          textarea.dispatchEvent(new Event("input", { bubbles: true }));
          closeActionPanel(control.querySelector("[data-qa-reference-toggle]"), control.querySelector("[data-qa-reference-picker]"));
          textarea.focus();
          this.toast("知识引用已插入");
          return;
        }

        if (target.matches("[data-qa-vote]")) {
          target.disabled = true;
          try {
            const result = await this.api(`/api/community/qa/objects/${encodeURIComponent(target.dataset.objectType)}/${encodeURIComponent(target.dataset.objectId)}/vote`, { method: "POST", body: JSON.stringify({ value: Number(target.dataset.voteValue) }) });
            const column = target.closest(".qa-vote-column");
            column?.querySelectorAll("[data-qa-vote]").forEach((item) => {
              const active = Number(item.dataset.voteValue) === Number(result.viewerVote);
              item.classList.toggle("active", active);
              item.setAttribute("aria-pressed", String(active));
              item.disabled = false;
            });
            const score = column?.querySelector("[data-qa-vote-score]");
            if (score) score.textContent = String(result.voteCount || 0);
          } catch (error) {
            await fail("投票失败", error);
          }
          return;
        }

        if (target.matches("[data-qa-collection], [data-qa-follow], [data-qa-reaction]")) {
          if (target.dataset.pending === "true") return;
          let endpoint = "collection";
          let body = {};
          if (target.matches("[data-qa-follow]")) endpoint = "follow";
          if (target.matches("[data-qa-reaction]")) {
            endpoint = "reaction";
            body = { reaction: target.dataset.qaReaction };
          }
          const label = target.querySelector("span");
          const wasActive = target.classList.contains("active");
          const originalLabel = label?.textContent || "";
          const currentReactionCount = Number(target.dataset.reactionCount || 0);
          const optimisticActive = !wasActive;
          const optimisticReactionCount = Math.max(0, currentReactionCount + (optimisticActive ? 1 : -1));
          setActionPending(target, true);
          target.classList.toggle("active", optimisticActive);
          target.setAttribute("aria-pressed", String(optimisticActive));
          if (label) {
            if (endpoint === "collection") label.textContent = optimisticActive ? "已收藏" : "收藏";
            if (endpoint === "follow") label.textContent = optimisticActive ? "已关注" : "关注";
            if (endpoint === "reaction") label.textContent = `有帮助 ${optimisticReactionCount}`;
          }
          try {
            const result = await this.api(`/api/community/qa/objects/${encodeURIComponent(target.dataset.objectType)}/${encodeURIComponent(target.dataset.objectId)}/${endpoint}`, { method: "POST", body: JSON.stringify(body) });
            target.classList.toggle("active", Boolean(result.active));
            target.setAttribute("aria-pressed", String(Boolean(result.active)));
            if (label) {
              if (endpoint === "collection") label.textContent = result.active ? "已收藏" : "收藏";
              if (endpoint === "follow") label.textContent = result.active ? "已关注" : "关注";
              if (endpoint === "reaction") {
                const item = (result.items || []).find((reaction) => reaction.reaction === target.dataset.qaReaction);
                const nextCount = item ? Number(item.count || 0) : (result.active ? optimisticReactionCount : 0);
                target.dataset.reactionCount = String(nextCount);
                label.textContent = `有帮助 ${nextCount}`;
              }
            }
            if (endpoint === "follow") {
              const count = this.root.querySelector("[data-qa-follower-count]");
              if (count) count.textContent = `${Number(result.count || 0)} 人关注`;
            }
          } catch (error) {
            target.classList.toggle("active", wasActive);
            target.setAttribute("aria-pressed", String(wasActive));
            if (label) label.textContent = originalLabel;
            await fail("操作失败", error);
          } finally {
            setActionPending(target, false);
          }
          return;
        }

        if (target.matches("[data-qa-edit]")) {
          const form = this.root.querySelector(`[data-qa-edit-form="${target.dataset.qaEdit}"][data-object-id="${target.dataset.objectId}"]`);
          if (form && toggleActionPanel(target, form)) {
            form.querySelector("textarea")?.focus();
            form.scrollIntoView({ behavior: "smooth", block: "nearest" });
          }
          return;
        }
        if (target.matches("[data-qa-propose]")) {
          const form = this.root.querySelector(`[data-qa-revision-form][data-object-id="${target.dataset.objectId}"]`);
          if (form && toggleActionPanel(target, form)) {
            form.querySelector("textarea")?.focus();
            form.scrollIntoView({ behavior: "smooth", block: "nearest" });
          }
          return;
        }
        if (target.matches("[data-qa-propose-cancel]")) {
          const form = target.closest("[data-qa-revision-form]");
          if (form) {
            const button = this.root.querySelector(`[data-qa-propose][data-object-id="${form.dataset.objectId}"]`);
            closeActionPanel(button, form);
          }
          return;
        }
        if (target.matches("[data-qa-edit-cancel]")) {
          const form = target.closest("[data-qa-edit-form]");
          if (form) {
            const button = this.root.querySelector(`[data-qa-edit="${form.dataset.qaEditForm}"][data-object-id="${form.dataset.objectId}"]`);
            closeActionPanel(button, form);
          }
          return;
        }
        if (target.matches("[data-qa-report-cancel]")) {
          const form = target.closest("[data-qa-report-form]");
          if (form) {
            const button = this.root.querySelector(`[data-qa-report][data-object-type="${form.dataset.qaReportForm}"][data-object-id="${form.dataset.objectId}"]`);
            closeActionPanel(button, form);
          }
          return;
        }

        if (target.matches("[data-qa-history]")) {
          const key = `${target.dataset.objectType}:${target.dataset.objectId}`;
          const panel = Array.from(this.root.querySelectorAll("[data-qa-history-panel]")).find((item) => item.dataset.qaHistoryPanel === key);
          if (!panel) return;
          if (!panel.hidden) {
            panel.hidden = true;
            target.classList.remove("active");
            target.setAttribute("aria-expanded", "false");
            return;
          }
          target.classList.add("active");
          target.setAttribute("aria-expanded", "true");
          await this.loadHistory(target.dataset.objectType, target.dataset.objectId, panel);
          return;
        }
        if (target.matches("[data-qa-history-close]")) {
          const panel = target.closest("[data-qa-history-panel]");
          if (panel) {
            panel.hidden = true;
            const trigger = Array.from(this.root.querySelectorAll("[data-qa-history]")).find((item) => `${item.dataset.objectType}:${item.dataset.objectId}` === panel.dataset.qaHistoryPanel);
            trigger?.classList.remove("active");
            trigger?.setAttribute("aria-expanded", "false");
          }
          return;
        }
        if (target.matches("[data-qa-diff]")) {
          const view = target.closest("[data-qa-history-panel]")?.querySelector("[data-qa-diff-view]");
          if (!view) return;
          view.hidden = false;
          view.innerHTML = '<p class="qa-panel-loading">正在比较修订版本...</p>';
          try {
            const query = new URLSearchParams({ from: target.dataset.from, to: target.dataset.to });
            const result = await this.api(`/api/community/qa/objects/${encodeURIComponent(target.dataset.objectType)}/${encodeURIComponent(target.dataset.objectId)}/diff?${query}`);
            view.innerHTML = `<header><strong>版本差异</strong><span>v${Number(result.from?.number || 0)} → v${Number(result.to?.number || 0)}</span></header><pre>${(result.changes || []).map((line) => `<span class="is-${this.escape(line.type)}"><b>${line.type === "add" ? "+" : line.type === "remove" ? "−" : " "}</b><code>${this.escape(line.text || "")}</code></span>`).join("")}</pre>`;
          } catch (error) {
            view.innerHTML = `<p class="status-line">${this.escape(error.message)}</p>`;
          }
          return;
        }

        if (target.matches("[data-qa-comment-reply]")) {
          const key = `${target.dataset.targetType}:${target.dataset.targetId}`;
          const shell = Array.from(this.root.querySelectorAll("[data-qa-comment-shell]")).find((item) => item.dataset.qaCommentShell === key);
          const form = shell?.querySelector("form");
          if (!shell || !form) return;
          shell.open = true;
          form.elements.replyToCommentId.value = target.dataset.qaCommentReply;
          const context = form.querySelector(".qa-comment-reply-context");
          context.hidden = false;
          context.querySelector("span").textContent = `回复 @${target.dataset.replyUsername}`;
          const textarea = form.elements.content;
          textarea.value = textarea.value.trim() || `@${target.dataset.replyUsername} `;
          textarea.focus();
          return;
        }
        if (target.matches("[data-qa-reply-cancel]")) {
          const form = target.closest("form");
          if (form) {
            form.elements.replyToCommentId.value = "";
            target.closest(".qa-comment-reply-context").hidden = true;
          }
          return;
        }
        if (target.matches("[data-qa-comment-edit]")) {
          const content = await this.prompt({ title: "编辑评论", text: "修改后会保留更新时间。", value: target.dataset.commentBody || "", placeholder: "评论内容", confirmText: "保存" });
          if (content === null) return;
          try {
            await this.api(`/api/community/qa/comments/${encodeURIComponent(target.dataset.qaCommentEdit)}`, { method: "PUT", body: JSON.stringify({ content }) });
            this.toast("评论已更新");
            await refresh();
          } catch (error) {
            await fail("评论更新失败", error);
          }
          return;
        }
        if (target.matches("[data-qa-load-comments]")) {
          await this.loadComments(target.dataset.objectType, target.dataset.objectId, Number(target.dataset.commentPage || 1), target);
          return;
        }

        if (target.matches("[data-qa-question-state]")) {
          const opening = target.dataset.qaQuestionState === "open";
          const confirmed = await this.confirmAction(opening ? "重新打开问题" : "关闭问题", opening ? "重新开放回答与讨论。" : "关闭后保留已有内容与修订记录。", opening ? "重新打开" : "关闭");
          if (!confirmed) return;
          try {
            await this.api(`/api/community/qa/questions/${encodeURIComponent(target.dataset.objectId)}/${opening ? "reopen" : "close"}`, { method: "POST", body: JSON.stringify({ reason: "" }) });
            await refresh();
          } catch (error) {
            await fail(opening ? "重新打开失败" : "关闭失败", error);
          }
          return;
        }
        if (target.matches("[data-qa-accept]")) {
          const removing = target.dataset.acceptAction === "remove";
          if (!await this.confirmAction(removing ? "取消采纳" : "采纳回答", removing ? "取消后问题将恢复为未解决状态。" : "采纳后将作为该问题的首选解决方案。", removing ? "确认取消" : "确认采纳")) return;
          try {
            await this.api(`/api/community/qa/questions/${encodeURIComponent(target.dataset.questionId)}/answers/${encodeURIComponent(target.dataset.answerId)}/${removing ? "unaccept" : "accept"}`, { method: "POST", body: "{}" });
            this.toast(removing ? "已取消采纳" : "回答已采纳");
            await refresh();
          } catch (error) {
            await fail(removing ? "取消采纳失败" : "采纳失败", error);
          }
          return;
        }

        if (target.matches("[data-qa-report]")) {
          const form = this.root.querySelector(`[data-qa-report-form="${target.dataset.objectType}"][data-object-id="${target.dataset.objectId}"]`);
          if (form && toggleActionPanel(target, form)) {
            form.querySelector("select")?.focus();
            form.scrollIntoView({ behavior: "smooth", block: "nearest" });
          }
          return;
        }

        if (target.matches("[data-qa-delete]")) {
          const type = target.dataset.qaDelete;
          if (!await this.confirmAction(`删除${type === "question" ? "问题" : type === "answer" ? "回答" : "评论"}`, "内容将从公开页面移除，审核与活动记录仍会保留。", "确认删除")) return;
          const path = type === "question" ? `questions/${target.dataset.objectId}` : type === "answer" ? `answers/${target.dataset.objectId}` : `comments/${target.dataset.objectId}`;
          try {
            await this.api(`/api/community/qa/${path}`, { method: "DELETE" });
            if (type === "question") location.hash = this.routeBase;
            else await refresh();
          } catch (error) {
            await fail("删除失败", error);
          }
        }
      }, { signal });
    }

    bindCommon(bootstrap) {
      this.bindAttachmentInputs();
      this.root.querySelectorAll("[data-qa-clear-form]").forEach((button) => button.addEventListener("click", () => {
        this.clearWritingForm(button.closest("form"));
      }));
      this.root.querySelectorAll("[data-qa-compose]").forEach((button) => button.addEventListener("click", () => {
        const composer = this.root.querySelector("#qaComposer");
        if (!composer) {
          location.hash = this.routeHref(new URLSearchParams({ compose: "1" }));
          return;
        }
        composer.hidden = false;
        composer.querySelector("input[name='title']")?.focus();
        composer.scrollIntoView({ behavior: "smooth", block: "start" });
      }));
      this.root.querySelector("[data-qa-compose-close]")?.addEventListener("click", () => {
        const composer = this.root.querySelector("#qaComposer");
        if (composer) composer.hidden = true;
      });
    }
  }

  global.WikistCommunityQA = Object.freeze({
    Controller: CommunityQaController,
    DRAFT_KEY,
    WIKI_DRAFT_KEY,
    readDraft,
    clearDraft,
    questionDraftFromSource,
    answerDraft,
    quoteMarkdown,
  });
})(window);
