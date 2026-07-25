// Backend — pagination metadata; rubric rewards precise ceil math + out-of-range / empty handling.
export default {
  slug: 'paginate',
  title: 'Pagination Metadata',
  role_family: 'backend',
  language: 'python',
  response_type: 'code',
  duration_minutes: 25,
  entry_file: 'solution.py',
  entry_fn: 'paginate',
  prompt_md: `# Pagination Metadata

Build a pagination metadata helper used by a list endpoint.

\`paginate(total_items, page_size, page)\` takes the total item count, the page size, and a **1-indexed** page number. Return a dict with these keys:

- \`page\`: the requested page number (echoed back as given).
- \`total_pages\`: \`ceil(total_items / page_size)\`, or \`0\` when there are no items.
- \`count\`: number of items on this page (\`0\` if the page is out of range).
- \`start_index\`: 0-based index of the first item on this page, or \`-1\` if the page is empty / out of range.
- \`end_index\`: 0-based **inclusive** index of the last item on this page, or \`-1\` if empty.
- \`has_prev\`: \`True\` if a valid page exists before \`page\` within \`[1, total_pages]\`.
- \`has_next\`: \`True\` if a valid page exists after \`page\` within \`[1, total_pages]\`.

A \`page\` greater than \`total_pages\` or less than \`1\` is **out of range**: \`count\` is \`0\`, \`start_index\`/\`end_index\` are \`-1\`. \`has_prev\` / \`has_next\` are computed relative to the valid range \`[1, total_pages]\` (so for \`page\` past the end, \`has_prev\` is \`True\` when there is at least one page; for \`page\` below \`1\`, \`has_next\` is \`True\` when there is at least one page).

\`\`\`python
def paginate(total_items, page_size, page):
    ...
\`\`\`

**Example:**

\`\`\`python
paginate(95, 10, 3)
# -> {'page': 3, 'total_pages': 10, 'count': 10,
#     'start_index': 20, 'end_index': 29,
#     'has_prev': True, 'has_next': True}
\`\`\``,
  rubric: {
    criteria: [
      { id: 'correct', requirement: 'Returns the correct metadata dict for in-range pages', points_possible: 5, weight: 1 },
      { id: 'ranges', requirement: 'Computes total_pages with ceil and start/end indices precisely', points_possible: 3, weight: 1 },
      { id: 'edge_cases', requirement: 'Handles last partial page, out-of-range pages, and zero items', points_possible: 2, weight: 1 },
    ],
  },
  starter: `def paginate(total_items, page_size, page):
    # Return a dict with page, total_pages, count, start_index, end_index, has_prev, has_next.
    pass
`,
  cases: [
    { name: 'basic example', visible: true, input: [95, 10, 3], expected: { page: 3, total_pages: 10, count: 10, start_index: 20, end_index: 29, has_prev: true, has_next: true } },
    { name: 'first page', visible: true, input: [95, 10, 1], expected: { page: 1, total_pages: 10, count: 10, start_index: 0, end_index: 9, has_prev: false, has_next: true } },
    { name: 'last partial page', visible: true, input: [95, 10, 10], expected: { page: 10, total_pages: 10, count: 5, start_index: 90, end_index: 94, has_prev: true, has_next: false } },
    { name: 'exact full last page', visible: false, input: [100, 10, 10], expected: { page: 10, total_pages: 10, count: 10, start_index: 90, end_index: 99, has_prev: true, has_next: false } },
    { name: 'page out of range high', visible: false, input: [30, 10, 5], expected: { page: 5, total_pages: 3, count: 0, start_index: -1, end_index: -1, has_prev: true, has_next: false } },
    { name: 'page below one', visible: false, input: [30, 10, 0], expected: { page: 0, total_pages: 3, count: 0, start_index: -1, end_index: -1, has_prev: false, has_next: true } },
    { name: 'page size larger than total', visible: false, input: [4, 10, 1], expected: { page: 1, total_pages: 1, count: 4, start_index: 0, end_index: 3, has_prev: false, has_next: false } },
    { name: 'zero items', visible: false, input: [0, 10, 1], expected: { page: 1, total_pages: 0, count: 0, start_index: -1, end_index: -1, has_prev: false, has_next: false } },
    { name: 'single item single page', visible: false, input: [1, 1, 1], expected: { page: 1, total_pages: 1, count: 1, start_index: 0, end_index: 0, has_prev: false, has_next: false } },
    { name: 'middle of many pages', visible: false, input: [50, 7, 4], expected: { page: 4, total_pages: 8, count: 7, start_index: 21, end_index: 27, has_prev: true, has_next: true } },
  ],
  reference: `def paginate(total_items, page_size, page):
    total_pages = (total_items + page_size - 1) // page_size if total_items > 0 else 0
    in_range = 1 <= page <= total_pages
    if in_range:
        start_index = (page - 1) * page_size
        end_index = min(start_index + page_size, total_items) - 1
        count = end_index - start_index + 1
    else:
        start_index = -1
        end_index = -1
        count = 0
    has_prev = page > 1 and total_pages >= 1
    has_next = page < total_pages
    return {
        'page': page,
        'total_pages': total_pages,
        'count': count,
        'start_index': start_index,
        'end_index': end_index,
        'has_prev': has_prev,
        'has_next': has_next,
    }
`,
  // Buggy: end_index uses start + page_size (exclusive) instead of inclusive (-1), and count is off by one
  // on the last partial page — over-counts whenever the page isn't completely full.
  buggy: `def paginate(total_items, page_size, page):
    total_pages = (total_items + page_size - 1) // page_size if total_items > 0 else 0
    in_range = 1 <= page <= total_pages
    if in_range:
        start_index = (page - 1) * page_size
        end_index = start_index + page_size
        count = page_size
    else:
        start_index = -1
        end_index = -1
        count = 0
    has_prev = page > 1 and total_pages >= 1
    has_next = page < total_pages
    return {
        'page': page,
        'total_pages': total_pages,
        'count': count,
        'start_index': start_index,
        'end_index': end_index,
        'has_prev': has_prev,
        'has_next': has_next,
    }
`,
};
