(function (global) {
  "use strict";

  const DEFAULT_SELECTOR = "[data-selection-content]";
  const BLOCKED_SELECTOR = "[data-selection-ignore],input,textarea,select,button,[contenteditable='true']";
  const HIGHLIGHT_NAME = "wikist-selection-anchors";
  const TARGET_HIGHLIGHT_NAME = "wikist-selection-target";

  function nodeElement(node) {
    if (!node) return null;
    return node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  }

  function contentRoot(node, selector) {
    const element = nodeElement(node);
    return element?.matches(selector) ? element : element?.closest(selector);
  }

  function selectedRoot(selection, selector) {
    if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) return null;
    const anchorRoot = contentRoot(selection.anchorNode, selector);
    const focusRoot = contentRoot(selection.focusNode, selector);
    return anchorRoot && anchorRoot === focusRoot ? anchorRoot : null;
  }

  function blockedSelection(selection, root) {
    const anchor = nodeElement(selection.anchorNode)?.closest(BLOCKED_SELECTOR);
    const focus = nodeElement(selection.focusNode)?.closest(BLOCKED_SELECTOR);
    return Boolean((anchor && root.contains(anchor)) || (focus && root.contains(focus)));
  }

  function rootOffset(root, container, offset) {
    const range = document.createRange();
    range.selectNodeContents(root);
    try {
      range.setEnd(container, offset);
      return range.toString().length;
    } catch (_error) {
      return 0;
    }
  }

  function cleanContext(value, limit) {
    const normalized = String(value || "").replace(/\u0000/g, "").replace(/\r\n?/g, "\n");
    return normalized.length > limit ? normalized.slice(normalized.length - limit) : normalized;
  }

  function createAnchor(root, range) {
    const raw = range.toString();
    const exact = raw.trim();
    const leading = raw.length - raw.trimStart().length;
    const trailing = raw.length - raw.trimEnd().length;
    const start = rootOffset(root, range.startContainer, range.startOffset) + leading;
    const end = rootOffset(root, range.endContainer, range.endOffset) - trailing;
    const text = root.textContent || "";
    return {
      exact,
      prefix: cleanContext(text.slice(Math.max(0, start - 180), start), 180),
      suffix: String(text.slice(end, end + 180)).replace(/\u0000/g, "").replace(/\r\n?/g, "\n"),
      start,
      end,
    };
  }

  function objectContext(root) {
    return {
      type: String(root.dataset.selectionObjectType || "article"),
      id: String(root.dataset.selectionObjectId || location.hash || location.pathname),
      label: String(root.dataset.selectionObjectLabel || document.title || "正文"),
      url: String(root.dataset.selectionObjectUrl || location.hash || "#/"),
      organizationSlug: String(root.dataset.selectionOrganizationSlug || ""),
      pageSlug: String(root.dataset.selectionPageSlug || ""),
    };
  }

  function textNodes(root) {
    const nodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!node.nodeValue || !parent || parent.closest("script,style,noscript,[data-selection-ignore]")) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let node;
    while ((node = walker.nextNode())) nodes.push(node);
    return nodes;
  }

  function rangeFromOffsets(root, start, end) {
    const nodes = textNodes(root);
    const range = document.createRange();
    let cursor = 0;
    let startPoint = null;
    let endPoint = null;
    for (const node of nodes) {
      const next = cursor + node.nodeValue.length;
      if (!startPoint && start >= cursor && start <= next) startPoint = [node, Math.min(node.nodeValue.length, start - cursor)];
      if (!endPoint && end >= cursor && end <= next) endPoint = [node, Math.min(node.nodeValue.length, end - cursor)];
      cursor = next;
      if (startPoint && endPoint) break;
    }
    if (!startPoint || !endPoint) return null;
    try {
      range.setStart(startPoint[0], startPoint[1]);
      range.setEnd(endPoint[0], endPoint[1]);
      return range;
    } catch (_error) {
      return null;
    }
  }

  function contextScore(text, start, exact, prefix, suffix) {
    let score = 0;
    const left = text.slice(Math.max(0, start - prefix.length), start);
    const right = text.slice(start + exact.length, start + exact.length + suffix.length);
    if (prefix && left.endsWith(prefix)) score += prefix.length * 2;
    if (suffix && right.startsWith(suffix)) score += suffix.length * 2;
    return score;
  }

  function rangeForRecord(root, record) {
    const exact = String(record.selectedText || "").trim();
    if (!exact) return null;
    const direct = rangeFromOffsets(root, Number(record.startOffset || 0), Number(record.endOffset || 0));
    if (direct && direct.toString().trim() === exact) return direct;
    const text = root.textContent || "";
    let index = text.indexOf(exact);
    let best = null;
    while (index >= 0) {
      const score = contextScore(text, index, exact, String(record.prefixText || ""), String(record.suffixText || ""));
      if (!best || score > best.score) best = { index, score };
      index = text.indexOf(exact, index + Math.max(1, exact.length));
    }
    return best ? rangeFromOffsets(root, best.index, best.index + exact.length) : null;
  }

  function selectionRect(range) {
    const rects = [...range.getClientRects()].filter((rect) => rect.width > 0 || rect.height > 0);
    if (rects.length) {
      const first = rects[0];
      const last = rects[rects.length - 1];
      return {
        left: Math.min(first.left, last.left),
        right: Math.max(first.right, last.right),
        top: Math.min(first.top, last.top),
        bottom: Math.max(first.bottom, last.bottom),
        width: Math.max(first.right, last.right) - Math.min(first.left, last.left),
        height: Math.max(first.bottom, last.bottom) - Math.min(first.top, last.top),
      };
    }
    return range.getBoundingClientRect();
  }

  function toolbarIcon(name) {
    const paths = {
      copy: '<rect x="7" y="7" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
      comment: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v7a2.5 2.5 0 0 1-2.5 2.5H9l-5 4V5.5Z"/>',
      search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
      like: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
      quote: '<path d="M7 17H4a2 2 0 0 1-2-2v-3a6 6 0 0 1 6-6h1v3H8a3 3 0 0 0-3 3h2v5Zm13 0h-3a2 2 0 0 1-2-2v-3a6 6 0 0 1 6-6h1v3h-1a3 3 0 0 0-3 3h2v5Z"/>',
      question: '<circle cx="12" cy="12" r="9"/><path d="M9.8 9a2.4 2.4 0 1 1 3.6 2.08c-.9.52-1.4 1.04-1.4 2.12M12 17h.01"/>',
      answer: '<path d="M4 4h16v12H8l-4 4V4Z"/><path d="M8 8h8M8 12h5"/>',
      post: '<path d="M5 3h14a2 2 0 0 1 2 2v14H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M8 8h8M8 12h8M8 16h5"/>',
      chat: '<path d="M21 12a8 8 0 0 1-8 8H5l-3 2 1-5a8 8 0 1 1 18-5Z"/>',
      delete: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3"/>',
    };
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.quote}</svg>`;
  }

  class SelectionApiClient {
    constructor(request) {
      if (typeof request !== "function") throw new TypeError("SelectionApiClient requires a request function");
      this.request = request;
    }

    resolve(snapshot, page = 1, create = false) {
      return this.request(`/api/selections/resolve?page=${Math.max(1, Number(page) || 1)}`, {
        method: "POST",
        body: JSON.stringify({ object: snapshot.object, selector: snapshot.selector, create: Boolean(create) }),
      });
    }

    detail(id) {
      return this.request(`/api/selections/${encodeURIComponent(id)}`);
    }

    comments(id, page = 1, limit = 20) {
      return this.request(`/api/selections/${encodeURIComponent(id)}/comments?page=${Math.max(1, Number(page) || 1)}&limit=${Math.max(1, Number(limit) || 20)}`);
    }

    markers(object) {
      return this.request(`/api/selections/markers?objectType=${encodeURIComponent(object.type)}&objectId=${encodeURIComponent(object.id)}`);
    }

    comment(id, bodyMd, replyToCommentId = 0) {
      return this.request(`/api/selections/${encodeURIComponent(id)}/comments`, {
        method: "POST",
        body: JSON.stringify({ bodyMd, replyToCommentId: Math.max(0, Number(replyToCommentId) || 0) }),
      });
    }

    deleteComment(id, commentId) {
      return this.request(`/api/selections/${encodeURIComponent(id)}/comments/${encodeURIComponent(commentId)}`, {
        method: "DELETE",
        body: "{}",
      });
    }

    like(id, liked) {
      return this.request(`/api/selections/${encodeURIComponent(id)}/like`, {
        method: "PUT",
        body: JSON.stringify({ liked: Boolean(liked) }),
      });
    }

    activity(id, input) {
      return this.request(`/api/selections/${encodeURIComponent(id)}/activities`, {
        method: "POST",
        body: JSON.stringify(input || {}),
      });
    }

    delete(id) {
      return this.request(`/api/selections/${encodeURIComponent(id)}`, {
        method: "DELETE",
        body: "{}",
      });
    }

    mine({ page = 1, limit = 12, mode = "all" } = {}) {
      return this.request(`/api/selections/mine?page=${Math.max(1, Number(page) || 1)}&limit=${Math.max(1, Number(limit) || 12)}&mode=${encodeURIComponent(mode)}`);
    }
  }

  class SelectionToolbar {
    constructor(options = {}) {
      this.selector = options.contentSelector || DEFAULT_SELECTOR;
      this.onAction = typeof options.onAction === "function" ? options.onAction : function () {};
      this.loadMarkers = typeof options.loadMarkers === "function" ? options.loadMarkers : null;
      this.snapshot = null;
      this.range = null;
      this.markers = [];
      this.refreshGeneration = 0;
      this.timer = 0;
      this.focusTimer = 0;
      this.raf = 0;
      this.destroyed = false;
      this.toolbar = this.createToolbar();
      this.handleSelectionChange = this.handleSelectionChange.bind(this);
      this.handlePointerUp = this.handlePointerUp.bind(this);
      this.handleOutsidePointer = this.handleOutsidePointer.bind(this);
      this.handleKeyUp = this.handleKeyUp.bind(this);
      this.handleViewport = this.handleViewport.bind(this);
      this.handleBlur = this.handleBlur.bind(this);
      document.addEventListener("selectionchange", this.handleSelectionChange);
      document.addEventListener("pointerup", this.handlePointerUp, true);
      document.addEventListener("touchend", this.handlePointerUp, true);
      document.addEventListener("pointerdown", this.handleOutsidePointer, true);
      document.addEventListener("keyup", this.handleKeyUp, true);
      window.addEventListener("scroll", this.handleViewport, true);
      window.addEventListener("resize", this.handleViewport);
      window.visualViewport?.addEventListener("resize", this.handleViewport);
      window.visualViewport?.addEventListener("scroll", this.handleViewport);
      window.addEventListener("blur", this.handleBlur);
    }

    createToolbar() {
      const node = document.createElement("div");
      node.className = "selection-toolbar";
      node.hidden = true;
      node.setAttribute("role", "toolbar");
      node.setAttribute("aria-label", "划词工具");
      node.innerHTML = `
        <button type="button" data-selection-action="copy">${toolbarIcon("copy")}<span>复制</span></button>
        <button type="button" data-selection-action="comment">${toolbarIcon("comment")}<span>批注</span></button>
        <button type="button" data-selection-action="question">${toolbarIcon("question")}<span>提问</span></button>
        <button type="button" data-selection-action="search">${toolbarIcon("search")}<span>搜索</span></button>
        <button type="button" data-selection-action="like" aria-pressed="false">${toolbarIcon("like")}<span>喜欢</span><em data-selection-like-count hidden>0</em></button>
        <button type="button" data-selection-action="delete" hidden>${toolbarIcon("delete")}<span>删除划词</span></button>
        <span class="selection-toolbar-reference">
          <button type="button" data-selection-action="quote" aria-haspopup="menu" aria-expanded="false">${toolbarIcon("quote")}<span>引用</span></button>
          <span class="selection-quote-menu" role="menu" hidden>
            <button type="button" role="menuitem" data-selection-quote="comment">${toolbarIcon("comment")}<span>引用到评论</span></button>
            <button type="button" role="menuitem" data-selection-quote="answer">${toolbarIcon("answer")}<span>引用到回答</span></button>
            <button type="button" role="menuitem" data-selection-quote="post">${toolbarIcon("post")}<span>引用到帖子</span></button>
            <button type="button" role="menuitem" data-selection-quote="chat">${toolbarIcon("chat")}<span>引用到聊天</span></button>
          </span>
        </span>`;
      node.addEventListener("pointerdown", (event) => event.preventDefault());
      node.addEventListener("click", (event) => this.handleAction(event));
      document.body.appendChild(node);
      return node;
    }

    handleSelectionChange() {
      window.clearTimeout(this.timer);
      this.timer = window.setTimeout(() => this.evaluate(), 90);
    }

    handlePointerUp(event) {
      if (this.toolbar.contains(event.target)) return;
      window.clearTimeout(this.timer);
      const touch = event.changedTouches?.[0];
      const point = { x: touch?.clientX ?? event.clientX, y: touch?.clientY ?? event.clientY, target: event.target };
      this.timer = window.setTimeout(() => this.evaluate(point), event.type === "touchend" ? 180 : 30);
    }

    handleKeyUp(event) {
      if (event.key === "Escape") {
        this.hide();
        return;
      }
      if (event.shiftKey || ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
        this.handleSelectionChange();
      }
    }

    handleOutsidePointer(event) {
      if (!this.toolbar.hidden && !this.toolbar.contains(event.target)) this.hide();
    }

    handleViewport() {
      if (this.toolbar.hidden || !this.range) return;
      cancelAnimationFrame(this.raf);
      this.raf = requestAnimationFrame(() => this.position());
    }

    handleBlur() {
      window.setTimeout(() => {
        if (!document.hasFocus()) this.hide();
      }, 0);
    }

    evaluate(point = null) {
      if (this.destroyed) return;
      const selection = window.getSelection();
      const root = selectedRoot(selection, this.selector);
      if (!root || blockedSelection(selection, root)) {
        const marker = point ? this.markerAtPoint(point) : null;
        if (marker) {
          this.activateMarker(marker);
          return;
        }
        this.hide();
        return;
      }
      const range = selection.getRangeAt(0).cloneRange();
      const selector = createAnchor(root, range);
      if (!selector.exact || selector.exact.length > 5000) {
        this.hide();
        return;
      }
      const marker = this.markers.find((item) => item.root === root
        && item.selector.start === selector.start
        && item.selector.end === selector.end
        && item.selector.exact === selector.exact);
      this.range = range;
      this.snapshot = { object: objectContext(root), selector, root, selection: marker?.record || null };
      this.setMarkerState(marker?.record || null);
      this.closeQuoteMenu();
      this.toolbar.hidden = false;
      this.toolbar.classList.add("is-visible");
      this.position();
    }

    markerAtPoint(point) {
      const target = nodeElement(point.target);
      if (!target || target.closest("a,button,input,textarea,select,[contenteditable='true']")) return null;
      const root = contentRoot(target, this.selector);
      if (!root) return null;
      let container = null;
      let offset = 0;
      if (document.caretPositionFromPoint) {
        const caret = document.caretPositionFromPoint(point.x, point.y);
        container = caret?.offsetNode || null;
        offset = caret?.offset || 0;
      } else if (document.caretRangeFromPoint) {
        const caret = document.caretRangeFromPoint(point.x, point.y);
        container = caret?.startContainer || null;
        offset = caret?.startOffset || 0;
      }
      if (!container || !root.contains(nodeElement(container))) return null;
      const absolute = rootOffset(root, container, offset);
      return this.markers
        .filter((item) => item.root === root && absolute >= item.selector.start && absolute <= item.selector.end)
        .sort((left, right) => (left.selector.end - left.selector.start) - (right.selector.end - right.selector.start))[0] || null;
    }

    activateMarker(marker) {
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(marker.range.cloneRange());
      this.range = marker.range.cloneRange();
      this.snapshot = { object: objectContext(marker.root), selector: marker.selector, root: marker.root, selection: marker.record };
      this.setMarkerState(marker.record);
      this.closeQuoteMenu();
      this.toolbar.hidden = false;
      this.toolbar.classList.add("is-visible");
      this.position();
    }

    async refresh(scope = document) {
      const generation = ++this.refreshGeneration;
      if (global.CSS?.highlights) CSS.highlights.delete(HIGHLIGHT_NAME);
      this.markers = [];
      if (!this.loadMarkers) return;
      const roots = [...new Set([
        ...(scope?.matches?.(this.selector) ? [scope] : []),
        ...(scope?.querySelectorAll?.(this.selector) || []),
      ])];
      const payloads = await Promise.all(roots.map(async (root) => {
        try {
          const result = await this.loadMarkers(objectContext(root));
          return { root, records: result?.items || [] };
        } catch (_error) {
          return { root, records: [] };
        }
      }));
      if (generation !== this.refreshGeneration) return;
      const ranges = [];
      for (const payload of payloads) {
        if (!payload.root.isConnected) continue;
        for (const record of payload.records) {
          const range = rangeForRecord(payload.root, record);
          if (!range) continue;
          const selector = createAnchor(payload.root, range);
          this.markers.push({ root: payload.root, record, range, selector });
          ranges.push(range);
        }
      }
      if (ranges.length && global.Highlight && global.CSS?.highlights) {
        CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(...ranges));
      }
      return this.markers;
    }

    focus(selectionId, options = {}) {
      const id = Number(selectionId || 0);
      const marker = this.markers.find((item) => Number(item.record?.id || 0) === id);
      if (!marker) return false;
      const rect = selectionRect(marker.range);
      const viewportHeight = window.visualViewport?.height || window.innerHeight;
      const targetTop = Math.max(0, window.scrollY + rect.top - (viewportHeight * 0.42));
      window.scrollTo({ top: targetTop, left: window.scrollX, behavior: options.behavior || "auto" });
      if (global.Highlight && global.CSS?.highlights) {
        CSS.highlights.set(TARGET_HIGHLIGHT_NAME, new Highlight(marker.range.cloneRange()));
        window.clearTimeout(this.focusTimer);
        this.focusTimer = window.setTimeout(() => CSS.highlights.delete(TARGET_HIGHLIGHT_NAME), 2600);
      }
      if (options.openToolbar) this.activateMarker(marker);
      return true;
    }

    position() {
      if (!this.range || this.toolbar.hidden) return;
      const rect = selectionRect(this.range);
      if (!rect || (!rect.width && !rect.height)) {
        this.hide();
        return;
      }
      const viewport = window.visualViewport;
      const viewportLeft = viewport?.offsetLeft || 0;
      const viewportTop = viewport?.offsetTop || 0;
      const viewportWidth = viewport?.width || window.innerWidth;
      const viewportHeight = viewport?.height || window.innerHeight;
      const toolbarRect = this.toolbar.getBoundingClientRect();
      const margin = 10;
      const gap = 10;
      let placement = "top";
      let top = rect.top - toolbarRect.height - gap;
      if (top < viewportTop + margin) {
        placement = "bottom";
        top = rect.bottom + gap;
      }
      top = Math.max(viewportTop + margin, Math.min(top, viewportTop + viewportHeight - toolbarRect.height - margin));
      const center = rect.left + (rect.width / 2);
      const left = Math.max(viewportLeft + margin, Math.min(center - (toolbarRect.width / 2), viewportLeft + viewportWidth - toolbarRect.width - margin));
      this.toolbar.dataset.placement = placement;
      this.toolbar.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
    }

    async handleAction(event) {
      const quote = event.target.closest("[data-selection-quote]");
      if (quote) {
        const kind = quote.dataset.selectionQuote;
        this.closeQuoteMenu();
        await this.runAction("quote", { kind });
        return;
      }
      const button = event.target.closest("[data-selection-action]");
      if (!button || !this.snapshot) return;
      const action = button.dataset.selectionAction;
      if (action === "quote") {
        const menu = this.toolbar.querySelector(".selection-quote-menu");
        const open = menu.hidden;
        menu.hidden = !open;
        button.setAttribute("aria-expanded", String(open));
        this.toolbar.classList.toggle("quote-open", open);
        this.position();
        return;
      }
      await this.runAction(action, { button });
    }

    async runAction(action, detail = {}) {
      const button = detail.button || null;
      if (button) button.disabled = true;
      try {
        const result = await this.onAction(action, {
          ...detail,
          snapshot: this.snapshot,
          toolbar: this,
        });
        if (result && typeof result.liked === "boolean") this.setLiked(result.liked, true, result.likeCount);
        if (result && typeof result.canDelete === "boolean") {
          const deleteButton = this.toolbar.querySelector('[data-selection-action="delete"]');
          if (deleteButton) deleteButton.hidden = !result.canDelete;
        }
        if (result?.deleted) this.hide();
      } finally {
        if (button?.isConnected) button.disabled = false;
      }
    }

    setLiked(liked, known = true, likeCount = 0) {
      const button = this.toolbar.querySelector('[data-selection-action="like"]');
      if (!button) return;
      const count = Math.max(0, Number(likeCount) || 0);
      button.classList.toggle("active", Boolean(liked));
      button.classList.toggle("is-unknown", !known);
      button.setAttribute("aria-pressed", String(Boolean(liked)));
      const label = button.querySelector("span");
      if (label) label.textContent = liked ? "已喜欢" : "喜欢";
      const countNode = button.querySelector("[data-selection-like-count]");
      if (countNode) {
        countNode.textContent = `${count} 人喜欢`;
        countNode.hidden = !known;
      }
    }

    setMarkerState(record) {
      this.setLiked(Boolean(record?.liked), Boolean(record), record?.likeCount);
      const deleteButton = this.toolbar.querySelector('[data-selection-action="delete"]');
      if (deleteButton) deleteButton.hidden = !record?.canDelete;
    }

    closeQuoteMenu() {
      const menu = this.toolbar.querySelector(".selection-quote-menu");
      const button = this.toolbar.querySelector('[data-selection-action="quote"]');
      if (menu) menu.hidden = true;
      if (button) button.setAttribute("aria-expanded", "false");
      this.toolbar.classList.remove("quote-open");
    }

    hide() {
      this.closeQuoteMenu();
      this.toolbar.classList.remove("is-visible");
      this.toolbar.hidden = true;
      this.toolbar.style.removeProperty("transform");
      this.range = null;
      this.snapshot = null;
    }

    destroy() {
      this.destroyed = true;
      window.clearTimeout(this.timer);
      window.clearTimeout(this.focusTimer);
      cancelAnimationFrame(this.raf);
      document.removeEventListener("selectionchange", this.handleSelectionChange);
      document.removeEventListener("pointerup", this.handlePointerUp, true);
      document.removeEventListener("touchend", this.handlePointerUp, true);
      document.removeEventListener("pointerdown", this.handleOutsidePointer, true);
      document.removeEventListener("keyup", this.handleKeyUp, true);
      window.removeEventListener("scroll", this.handleViewport, true);
      window.removeEventListener("resize", this.handleViewport);
      window.visualViewport?.removeEventListener("resize", this.handleViewport);
      window.visualViewport?.removeEventListener("scroll", this.handleViewport);
      window.removeEventListener("blur", this.handleBlur);
      if (global.CSS?.highlights) CSS.highlights.delete(HIGHLIGHT_NAME);
      if (global.CSS?.highlights) CSS.highlights.delete(TARGET_HIGHLIGHT_NAME);
      this.toolbar.remove();
    }
  }

  global.WikistSelection = Object.freeze({
    SelectionToolbar,
    SelectionApiClient,
    createAnchor,
    objectContext,
    rangeForRecord,
  });
})(window);
