// The DOM helpers every page's script uses.

export const $ = (id) => document.getElementById(id);

// A new `tag` element: `props` gives its attributes, `class` its class and
// each on… key a listener; `children` are nodes or text, in arrays nested
// as deep as they come, and null and false among them are left out.
export function el(tag, props, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child != null && child !== false) node.append(child);
  }
  return node;
}
