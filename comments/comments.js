/**
 * =============================================================================
 * AnimeEdge Modular Comments Engine (/comments/comments.js - v3.1 Strict Closed Lock)
 * =============================================================================
 *  - Strict 100-character / alphabet enforcement (Unicode and emoji safe)
 *  - Real-time character counter indicator with limit validation
 *  - YouTube/Instagram nested thread hierarchy and collapsible replies
 *  - Zero-auth persistent anonymous identity via device-bound UUID
 *  - Optimistic likes, unlikes, and vote persistence
 *  - Hard-Enforced Closed State: Will NEVER open automatically during mount or fetch
 * =============================================================================
 */

import { CONFIG } from '/providers.js';
import { showPlayerToast } from '/script.js';

export class CommentEngine {
  constructor() {
    this.anilistId = null;
    this.episode = null;
    this.container = null;
    this.comments = [];
    this.userVotes = new Map();
    this.openReplyBoxes = new Set();
    this.collapsedThreads = new Set();
    this.sortBy = 'top';
    this.isSubmitting = false;

    if (!localStorage.getItem('animeedge_user_uid')) {
      localStorage.setItem('animeedge_user_uid', crypto.randomUUID());
    }
    this.userId = localStorage.getItem('animeedge_user_uid');

    this.loadPersistedVotes();
  }

  loadPersistedVotes() {
    try {
      const stored = localStorage.getItem('animeedge_votes_map');
      if (stored) {
        const parsed = JSON.parse(stored);
        this.userVotes = new Map(Object.entries(parsed).map(([k, v]) => [Number(k), Number(v)]));
      }
    } catch {
      this.userVotes = new Map();
    }
  }

  persistVotes() {
    try {
      const obj = Object.fromEntries(this.userVotes.entries());
      localStorage.setItem('animeedge_votes_map', JSON.stringify(obj));
    } catch {}
  }

  /**
   * Initializes or refreshes the comment thread for the active episode.
   * Strictly keeps the parent drawer closed during lifecycle operations.
   */
  async mount(containerId, anilistId, episode) {
    this.container = document.getElementById(containerId);
    this.anilistId = anilistId;
    this.episode = episode;

    if (!this.container) return;

    // Hard safeguard: Force parent drawer to remain closed on mount
    const parentDrawer = this.container.closest('.glass-drawer') || document.getElementById('commentsDrawer');
    if (parentDrawer) {
      parentDrawer.classList.remove('open');
      parentDrawer.setAttribute('aria-hidden', 'true');
    }

    this.renderSkeleton();
    await this.fetchAndRenderComments();

    // Re-verify drawer stays closed after async network fetch
    if (parentDrawer) {
      parentDrawer.classList.remove('open');
      parentDrawer.setAttribute('aria-hidden', 'true');
    }
  }

  renderSkeleton() {
    const savedName = localStorage.getItem('animeedge_username') || '';
    const avatarUrl = this.getAvatarUrl(savedName || this.userId);

    this.container.innerHTML = `
      <div class="comments-shell">
        <div class="comments-header-bar">
          <div class="comments-count-title">
            <span class="count-badge" id="totalCommentsBadge">0</span>
            <span class="count-text">Comments</span>
          </div>
          <div class="comments-sort-group">
            <button type="button" class="sort-chip ${this.sortBy === 'top' ? 'active' : ''}" data-sort="top">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
              Top
            </button>
            <button type="button" class="sort-chip ${this.sortBy === 'newest' ? 'active' : ''}" data-sort="newest">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              Newest
            </button>
          </div>
        </div>

        <div class="comment-composer">
          <div class="composer-user-row">
            <img src="${avatarUrl}" class="composer-avatar" id="currentComposerAvatar" alt="Avatar">
            <input 
              type="text" 
              id="composerUsername" 
              class="composer-name-input" 
              placeholder="Username (optional, e.g. ZoroFan)" 
              maxlength="24"
              autocomplete="off"
              value="${this.escapeHTML(savedName)}"
            >
          </div>
          <div class="composer-textarea-wrap">
            <textarea 
              id="composerContent" 
              class="composer-textarea" 
              placeholder="Add a comment... (Max 100 characters)" 
              maxlength="100"
            ></textarea>
          </div>
          <div class="composer-footer">
            <span id="composerCharCount" class="word-counter">0 / 100 characters</span>
            <button type="button" id="btnPostComment" class="comment-submit-btn" disabled>Comment</button>
          </div>
        </div>

        <div class="comments-feed" id="commentsFeed">
          <div class="comments-loading-state">
            <div class="loading-spinner" style="width:28px;height:28px;margin:0 auto 10px;"></div>
            Loading community discussion...
          </div>
        </div>
      </div>
    `;

    this.bindComposerEvents();
    this.bindSortingEvents();
  }

  bindSortingEvents() {
    const chips = this.container.querySelectorAll('.sort-chip');
    chips.forEach((chip) => {
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        const nextSort = chip.dataset.sort;
        if (this.sortBy === nextSort) return;
        this.sortBy = nextSort;
        chips.forEach((c) => c.classList.remove('active'));
        chip.classList.add('active');
        this.renderFeed();
      });
    });
  }

  bindComposerEvents() {
    const contentInput = document.getElementById('composerContent');
    const nameInput = document.getElementById('composerUsername');
    const charCounter = document.getElementById('composerCharCount');
    const submitBtn = document.getElementById('btnPostComment');
    const avatarImg = document.getElementById('currentComposerAvatar');

    nameInput?.addEventListener('input', () => {
      const val = nameInput.value.trim();
      localStorage.setItem('animeedge_username', val);
      if (avatarImg) {
        avatarImg.src = this.getAvatarUrl(val || this.userId);
      }
    });

    contentInput?.addEventListener('input', () => {
      const text = contentInput.value;
      const count = Array.from(text).length;
      if (charCounter) charCounter.textContent = `${count} / 100 characters`;

      if (count > 100) {
        charCounter?.classList.add('limit-exceeded');
        if (submitBtn) submitBtn.disabled = true;
      } else {
        charCounter?.classList.remove('limit-exceeded');
        if (submitBtn) submitBtn.disabled = count === 0;
      }
    });

    submitBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.submitComment(null, contentInput.value);
    });
  }

  async fetchAndRenderComments() {
    const feed = document.getElementById('commentsFeed');
    if (!feed) return;

    try {
      const res = await fetch(
        `${CONFIG.API_BASE_URL}/api/v1/comments?anilistId=${this.anilistId}&episode=${this.episode}`
      );
      const data = await res.json();

      if (!data.success || !Array.isArray(data.comments)) {
        throw new Error(data.error || 'Failed to fetch comments');
      }

      this.comments = data.comments;
      this.renderFeed();
    } catch {
      if (feed) {
        feed.innerHTML = `
          <div class="comments-empty-state" style="color:#ff3366;">
            Unable to connect to community network.<br>Please verify your gateway connection.
          </div>
        `;
      }
    }
  }

  renderFeed() {
    const feed = document.getElementById('commentsFeed');
    const totalBadge = document.getElementById('totalCommentsBadge');
    if (!feed) return;

    if (totalBadge) {
      totalBadge.textContent = this.comments.length;
    }

    if (this.comments.length === 0) {
      feed.innerHTML = `
        <div class="comments-empty-state">
          No comments yet on Episode ${this.episode}.<br>Share your thoughts with the community!
        </div>
      `;
      return;
    }

    const parents = this.comments.filter((c) => !c.parent_id);
    const replies = this.comments.filter((c) => c.parent_id);

    if (this.sortBy === 'top') {
      parents.sort((a, b) => ((b.likes_count || 0) - (b.dislikes_count || 0)) - ((a.likes_count || 0) - (a.dislikes_count || 0)));
    } else {
      parents.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }

    feed.innerHTML = parents
      .map((parent) => this.renderThreadHTML(parent, replies))
      .join('');

    this.bindFeedInteractions();
  }

  renderThreadHTML(comment, allReplies) {
    const children = allReplies.filter((r) => r.parent_id === comment.id);
    const avatarUrl = this.getAvatarUrl(comment.avatar_seed || comment.username);
    const userVote = this.userVotes.get(comment.id) || 0;
    const isThreadCollapsed = this.collapsedThreads.has(comment.id);
    const isReplyBoxOpen = this.openReplyBoxes.has(comment.id);

    const likesCount = comment.likes_count || 0;
    const displayLikes = likesCount > 0 ? this.formatCompactNumber(likesCount) : '';

    return `
      <div class="comment-thread" data-thread-id="${comment.id}">
        <div class="comment-card ${comment.is_pinned ? 'pinned' : ''}">
          <img src="${avatarUrl}" class="comment-avatar" alt="Avatar" loading="lazy">
          <div class="comment-content-area">
            <div class="comment-header">
              ${comment.is_pinned ? '<span class="pinned-badge">📌 PINNED</span>' : ''}
              <span class="comment-user">${this.escapeHTML(comment.username || 'Otaku')}</span>
              <span class="comment-time">${this.formatTimestamp(comment.created_at)}</span>
            </div>
            
            <div class="comment-text">${this.formatCommentText(comment.content)}</div>

            <div class="comment-actions" data-comment-id="${comment.id}">
              <button type="button" class="comment-action-btn btn-like ${userVote === 1 ? 'active-like' : ''}" title="Like">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="${userVote === 1 ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/>
                </svg>
                <span class="like-counter-val">${displayLikes}</span>
              </button>

              <button type="button" class="comment-action-btn btn-dislike ${userVote === -1 ? 'active-dislike' : ''}" title="Dislike">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="${userVote === -1 ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3"/>
                </svg>
              </button>

              <button type="button" class="comment-action-btn btn-reply-toggle">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                Reply
              </button>
            </div>

            <div class="reply-input-box" id="replyBox-${comment.id}" style="${isReplyBoxOpen ? 'display:flex;' : 'display:none;'}">
              <textarea 
                id="replyInput-${comment.id}" 
                class="reply-textarea" 
                placeholder="Reply to @${this.escapeHTML(comment.username)}... (Max 100 characters)" 
                maxlength="100"
              ></textarea>
              <div class="reply-box-footer">
                <span id="replyCharCount-${comment.id}" class="word-counter">0 / 100 characters</span>
                <div class="reply-btn-group">
                  <button type="button" class="reply-cancel-btn" data-cancel-id="${comment.id}">Cancel</button>
                  <button type="button" class="reply-submit-btn" data-submit-id="${comment.id}" disabled>Reply</button>
                </div>
              </div>
            </div>
          </div>
        </div>

        ${
          children.length > 0
            ? `
          <div class="replies-wrapper">
            <button type="button" class="thread-collapse-btn" data-parent-id="${comment.id}">
              <div class="thread-line-indicator"></div>
              <span>${isThreadCollapsed ? `View ${children.length} replies` : `Hide replies`}</span>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="${isThreadCollapsed ? '' : 'transform:rotate(180deg);'}"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            <div class="replies-block" id="repliesBlock-${comment.id}" style="${isThreadCollapsed ? 'display:none;' : 'display:flex;'}">
              ${children.map((child) => this.renderChildHTML(child)).join('')}
            </div>
          </div>
        `
            : ''
        }
      </div>
    `;
  }

  renderChildHTML(reply) {
    const avatarUrl = this.getAvatarUrl(reply.avatar_seed || reply.username);
    const userVote = this.userVotes.get(reply.id) || 0;
    const likesCount = reply.likes_count || 0;
    const displayLikes = likesCount > 0 ? this.formatCompactNumber(likesCount) : '';

    return `
      <div class="comment-card reply-card" data-comment-id="${reply.id}">
        <img src="${avatarUrl}" class="comment-avatar small" alt="Avatar" loading="lazy">
        <div class="comment-content-area">
          <div class="comment-header">
            <span class="comment-user">${this.escapeHTML(reply.username || 'Otaku')}</span>
            <span class="comment-time">${this.formatTimestamp(reply.created_at)}</span>
          </div>
          <div class="comment-text">${this.formatCommentText(reply.content)}</div>
          <div class="comment-actions" data-comment-id="${reply.id}">
            <button type="button" class="comment-action-btn btn-like ${userVote === 1 ? 'active-like' : ''}" title="Like">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="${userVote === 1 ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/>
              </svg>
              <span class="like-counter-val">${displayLikes}</span>
            </button>
            <button type="button" class="comment-action-btn btn-dislike ${userVote === -1 ? 'active-dislike' : ''}" title="Dislike">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="${userVote === -1 ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
    `;
  }

  bindFeedInteractions() {
    const feed = document.getElementById('commentsFeed');
    if (!feed) return;

    feed.querySelectorAll('.btn-reply-toggle').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const actions = e.target.closest('.comment-actions');
        const cId = Number(actions?.dataset.commentId);
        const box = document.getElementById(`replyBox-${cId}`);
        if (box) {
          const isOpening = box.style.display === 'none';
          box.style.display = isOpening ? 'flex' : 'none';
          if (isOpening) {
            this.openReplyBoxes.add(cId);
            const textarea = document.getElementById(`replyInput-${cId}`);
            textarea?.focus();
            this.bindReplyTextareaValidation(cId);
          } else {
            this.openReplyBoxes.delete(cId);
          }
        }
      });
    });

    feed.querySelectorAll('.reply-cancel-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const cId = Number(e.target.dataset.cancelId);
        const box = document.getElementById(`replyBox-${cId}`);
        if (box) box.style.display = 'none';
        this.openReplyBoxes.delete(cId);
      });
    });

    feed.querySelectorAll('.reply-submit-btn').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const parentId = Number(e.target.dataset.submitId);
        const input = document.getElementById(`replyInput-${parentId}`);
        if (input) {
          await this.submitComment(parentId, input.value);
        }
      });
    });

    feed.querySelectorAll('.thread-collapse-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const targetBtn = e.target.closest('.thread-collapse-btn');
        const pId = Number(targetBtn.dataset.parentId);
        const block = document.getElementById(`repliesBlock-${pId}`);
        if (block) {
          const isCollapsing = block.style.display !== 'none';
          block.style.display = isCollapsing ? 'none' : 'flex';
          if (isCollapsing) {
            this.collapsedThreads.add(pId);
          } else {
            this.collapsedThreads.delete(pId);
          }
          const svg = targetBtn.querySelector('svg');
          if (svg) svg.style.transform = isCollapsing ? '' : 'rotate(180deg)';
          const span = targetBtn.querySelector('span');
          const count = block.children.length;
          if (span) span.textContent = isCollapsing ? `View ${count} replies` : 'Hide replies';
        }
      });
    });

    feed.querySelectorAll('.btn-like').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const actions = e.target.closest('.comment-actions');
        const cId = Number(actions?.dataset.commentId);
        this.handleVote(cId, 1, actions);
      });
    });

    feed.querySelectorAll('.btn-dislike').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const actions = e.target.closest('.comment-actions');
        const cId = Number(actions?.dataset.commentId);
        this.handleVote(cId, -1, actions);
      });
    });
  }

  bindReplyTextareaValidation(parentId) {
    const textarea = document.getElementById(`replyInput-${parentId}`);
    const charCounter = document.getElementById(`replyCharCount-${parentId}`);
    const submitBtn = document.querySelector(`.reply-submit-btn[data-submit-id="${parentId}"]`);

    if (!textarea || textarea._bound) return;
    textarea._bound = true;

    textarea.addEventListener('input', () => {
      const text = textarea.value;
      const count = Array.from(text).length;
      if (charCounter) charCounter.textContent = `${count} / 100 characters`;

      if (count > 100) {
        charCounter?.classList.add('limit-exceeded');
        if (submitBtn) submitBtn.disabled = true;
      } else {
        charCounter?.classList.remove('limit-exceeded');
        if (submitBtn) submitBtn.disabled = count === 0;
      }
    });
  }

  async submitComment(parentId, contentRaw) {
    if (this.isSubmitting) return;

    const content = (contentRaw || '').trim();
    if (!content) return;

    const charCount = Array.from(content).length;
    if (charCount > 100) {
      showPlayerToast('Comment exceeds maximum 100 characters!', 'error', 2500);
      return;
    }

    this.isSubmitting = true;
    const submitBtn = parentId
      ? document.querySelector(`.reply-submit-btn[data-submit-id="${parentId}"]`)
      : document.getElementById('btnPostComment');

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Posting...';
    }

    const username = localStorage.getItem('animeedge_username') || 'Otaku';

    try {
      const res = await fetch(`${CONFIG.API_BASE_URL}/api/v1/comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-session-token': window.API_SESSION_TOKEN || ''
        },
        body: JSON.stringify({
          anilistId: this.anilistId,
          episode: this.episode,
          parent_id: parentId ? Number(parentId) : null,
          user_id: this.userId,
          username: username,
          content: content
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to publish comment');
      }

      showPlayerToast('Comment posted!', 'success', 1800);

      if (parentId) {
        this.openReplyBoxes.delete(parentId);
        this.collapsedThreads.delete(parentId);
      } else {
        const composerTextarea = document.getElementById('composerContent');
        if (composerTextarea) {
          composerTextarea.value = '';
          const charCountEl = document.getElementById('composerCharCount');
          if (charCountEl) charCountEl.textContent = '0 / 100 characters';
        }
      }

      await this.fetchAndRenderComments();
    } catch (err) {
      showPlayerToast(err.message || 'Error posting comment.', 'error', 2500);
    } finally {
      this.isSubmitting = false;
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = parentId ? 'Reply' : 'Comment';
      }
    }
  }

  async handleVote(commentId, voteType, actionsEl) {
    const currentVote = this.userVotes.get(commentId) || 0;
    const newVote = currentVote === voteType ? 0 : voteType;

    this.userVotes.set(commentId, newVote);
    this.persistVotes();

    const likeBtn = actionsEl.querySelector('.btn-like');
    const dislikeBtn = actionsEl.querySelector('.btn-dislike');
    const countSpan = actionsEl.querySelector('.like-counter-val');

    let likes = 0;
    const targetComment = this.comments.find((c) => c.id === commentId);
    if (targetComment) {
      if (currentVote === 1) targetComment.likes_count = Math.max(0, (targetComment.likes_count || 1) - 1);
      if (newVote === 1) targetComment.likes_count = (targetComment.likes_count || 0) + 1;
      likes = targetComment.likes_count;
    }

    if (countSpan) {
      countSpan.textContent = likes > 0 ? this.formatCompactNumber(likes) : '';
    }

    if (likeBtn) {
      likeBtn.classList.toggle('active-like', newVote === 1);
      const svg = likeBtn.querySelector('svg');
      if (svg) svg.setAttribute('fill', newVote === 1 ? 'currentColor' : 'none');
    }

    if (dislikeBtn) {
      dislikeBtn.classList.toggle('active-dislike', newVote === -1);
      const svg = dislikeBtn.querySelector('svg');
      if (svg) svg.setAttribute('fill', newVote === -1 ? 'currentColor' : 'none');
    }

    try {
      await fetch(`${CONFIG.API_BASE_URL}/api/v1/comments/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          comment_id: commentId,
          user_id: this.userId,
          vote_type: newVote
        })
      });
    } catch {}
  }

  getAvatarUrl(seed) {
    return `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(seed)}&backgroundColor=090d16`;
  }

  formatTimestamp(dateStr) {
    if (!dateStr) return 'Just now';
    try {
      const date = new Date(dateStr.endsWith('Z') ? dateStr : `${dateStr}Z`);
      const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);

      if (diffSec < 60) return 'Just now';
      if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
      if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
      if (diffSec < 604800) return `${Math.floor(diffSec / 86400)}d ago`;
      return date.toLocaleDateString();
    } catch {
      return dateStr;
    }
  }

  formatCompactNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    return String(num);
  }

  formatCommentText(raw) {
    if (!raw) return '';
    const escaped = this.escapeHTML(raw);
    return escaped.replace(/@([a-zA-Z0-9_\u4e00-\u9fa5]+)/g, '<span class="comment-mention">@$1</span>');
  }

  escapeHTML(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

export const Comments = new CommentEngine();
