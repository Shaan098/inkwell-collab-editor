// A visitor is a name, a colour and a random site id. The site id is part of every
// character's id, so it must be unique per open tab: it is NOT stored between sessions.
const COLORS = ['#c2410c', '#0e7c86', '#6d4fc2', '#b4236b', '#2f7d32', '#1d63c9', '#a16207'];
const ANIMALS = ['Otter', 'Heron', 'Lynx', 'Wren', 'Marten', 'Ibis', 'Stoat', 'Finch'];

const rand = (n) => Math.floor(Math.random() * n);
const siteId = () => Array.from({ length: 8 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[rand(36)]).join('');

export function loadIdentity() {
  let name = null, color = null;
  try {
    name = localStorage.getItem('inkwell_name');
    color = localStorage.getItem('inkwell_color');
  } catch { /* storage unavailable: use defaults */ }
  name = name || `${ANIMALS[rand(ANIMALS.length)]} ${10 + rand(90)}`;
  color = color || COLORS[rand(COLORS.length)];
  return { name, color, site: siteId() };
}

export function saveIdentity({ name, color }) {
  try {
    localStorage.setItem('inkwell_name', name);
    localStorage.setItem('inkwell_color', color);
  } catch { /* ignore */ }
}
