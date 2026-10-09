const tokenize = (text) => text.match(/\s+|[^\s]+/gu) || [];

function buildDiff(original, revised) {
  const a = tokenize(original);
  const b = tokenize(revised);

  // Evita matrizes excessivas em textos muito longos. Nesses casos, o
  // comparador apresenta com segurança as duas versões integralmente.
  if (a.length * b.length > 2_000_000) {
    return {
      originalParts: [{ text: original, type: 'removed' }],
      revisedParts: [{ text: revised, type: 'added' }]
    };
  }

  const rows = a.length + 1;
  const cols = b.length + 1;
  const table = Array.from({ length: rows }, () => new Uint32Array(cols));

  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i][j] = a[i] === b[j]
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const originalParts = [];
  const revisedParts = [];
  let i = 0;
  let j = 0;

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      originalParts.push({ text: a[i], type: 'same' });
      revisedParts.push({ text: b[j], type: 'same' });
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      originalParts.push({ text: a[i], type: 'removed' });
      i += 1;
    } else {
      revisedParts.push({ text: b[j], type: 'added' });
      j += 1;
    }
  }
  while (i < a.length) originalParts.push({ text: a[i++], type: 'removed' });
  while (j < b.length) revisedParts.push({ text: b[j++], type: 'added' });
  return { originalParts, revisedParts };
}

function renderParts(container, parts) {
  container.replaceChildren();
  const fragment = document.createDocumentFragment();
  parts.forEach(({ text, type }) => {
    const node = type === 'same' ? document.createTextNode(text) : document.createElement('mark');
    if (type !== 'same') {
      node.className = type;
      node.textContent = text;
    }
    fragment.append(node);
  });
  container.append(fragment);
}

export function setupComparison() {
  const dialog = document.querySelector('#compareDialog');
  const closeButton = document.querySelector('#closeCompareButton');
  const originalContainer = document.querySelector('#originalComparison');
  const humanizedContainer = document.querySelector('#humanizedComparison');

  closeButton.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });

  return {
    open(original, humanized) {
      if (!original.trim() || !humanized.trim()) return false;
      const diff = buildDiff(original, humanized);
      renderParts(originalContainer, diff.originalParts);
      renderParts(humanizedContainer, diff.revisedParts);
      dialog.showModal();
      return true;
    }
  };
}
