// chats-plan-manager.js (UI side)
// Manages the collapsible todos drawer, checklist items, and progress bars
// Strict traditional function declarations only

export function parseChecklistItems(planStr) {
  if (!planStr || typeof planStr !== 'string') return [];
  var lines = planStr.split('\n');
  var items = [];
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    var match = line.match(/^[-*]\s*\[([ x!>])\]\s*(.*)$/i);
    if (match) {
      items.push({
        status: match[1] === 'x' ? 'completed' : match[1] === '!' ? 'failed' : match[1] === '>' ? 'active' : 'pending',
        text: match[2].trim()
      });
    }
  }
  return items;
}

export function computePlanProgress(items) {
  if (!items || !items.length) return { completed: 0, total: 0, percentage: 0 };
  var completed = 0;
  for (var i = 0; i < items.length; i++) {
    if (items[i].status === 'completed') completed++;
  }
  return {
    completed: completed,
    total: items.length,
    percentage: Math.round((completed / items.length) * 100)
  };
}
