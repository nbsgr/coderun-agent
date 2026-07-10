// skillsManager.js — Manages agent skills
// Placeholder architecture — skills are reusable prompt fragments

var skills = {};

export function register(name, prompt, meta) {
  skills[name] = {
    name: name,
    prompt: prompt,
    meta: meta || {},
    registeredAt: Date.now()
  };
}

export function remove(name) {
  delete skills[name];
}

export function get(name) {
  return skills[name] || null;
}

export function list() {
  return Object.keys(skills);
}

export function load(name, prompt) {
  register(name, prompt);
}

export function getPrompt(names) {
  if (!names || !names.length) {
    names = Object.keys(skills);
  }
  var fragments = [];
  for (var i = 0; i < names.length; i++) {
    var skill = skills[names[i]];
    if (skill) fragments.push(skill.prompt);
  }
  return fragments.join('\n\n');
}

export function getAllPrompts() {
  return getPrompt(Object.keys(skills));
}

export function clear() {
  skills = {};
}