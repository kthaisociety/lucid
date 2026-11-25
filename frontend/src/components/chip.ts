// The toggle buttons in a filter bar (the board's, the calendar's).
export const chip = (active: boolean) =>
  `flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition ${
    active ? 'border-indigo-200 bg-indigo-50 text-indigo-700' : 'border-gray-200 bg-surface text-gray-600 hover:bg-gray-50'
  }`
