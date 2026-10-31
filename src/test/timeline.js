/**
 * Fixture for the first page of `listPRTimelinePage` (#507): review comments plus conversation
 * comments, with page info that says everything is loaded unless overridden.
 * @param comments  review-thread comments (flat, roots then replies)
 * @param conversation  PR conversation (issue) comments
 * @param over  overrides for `threads` / `conversationPage` page info
 */
export function timelinePage(comments = [], conversation = [], over = {}) {
  const threadIds = new Set(comments.map(c => c.threadId))
  return {
    comments,
    conversation,
    threads: { total: threadIds.size, hasNextPage: false, endCursor: null, ...over.threads },
    conversationPage: { total: conversation.length, hasNextPage: false, endCursor: null, ...over.conversationPage },
  }
}
