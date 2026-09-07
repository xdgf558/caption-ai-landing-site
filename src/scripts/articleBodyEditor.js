import TurndownService from 'turndown';
import { tables } from 'turndown-plugin-gfm';
import { articleBodyLimit, formatArticleMarkdown, localArticleImage, normalizeArticleLink } from '../articleMarkdown.js';

export function markdownFromClipboard(html) {
  if (html.length > 1000000) throw Error('粘贴内容过大，请分段粘贴。');
  // Templates stay detached and inert: pasted resources/scripts are never mounted or fetched.
  const template = document.createElement('template');
  template.innerHTML = html;
  const root = template.content;
  if (root.querySelectorAll('*').length > 10000) throw Error('粘贴内容过于复杂，请使用纯文本粘贴。');
  root.querySelectorAll('script,style,iframe,object,embed,svg,math,link,meta,base,form,input,button,textarea,select,noscript').forEach(node => node.remove());
  root.querySelectorAll('[hidden],[aria-hidden="true"]').forEach(node => node.remove());
  root.querySelectorAll('a').forEach(node => {
    const href = normalizeArticleLink(node.getAttribute('href'));
    if (href) node.setAttribute('href', href); else node.replaceWith(...node.childNodes);
  });
  root.querySelectorAll('img').forEach(node => {
    const src = localArticleImage(node.getAttribute('src'));
    if (src) node.setAttribute('src', src); else node.replaceWith(document.createTextNode(node.getAttribute('alt') || ''));
  });
  root.querySelectorAll('[style]').forEach(node => {
    if (node.style.display === 'none' || node.style.visibility === 'hidden') { node.remove(); return; }
    const weight = node.style.fontWeight;
    if ((weight === 'bold' || Number(weight) >= 600) && !['STRONG', 'B'].includes(node.tagName)) {
      const strong = document.createElement('strong'); strong.append(...node.childNodes); node.append(strong);
    }
    if (node.style.fontStyle === 'italic' && !['EM', 'I'].includes(node.tagName)) {
      const em = document.createElement('em'); em.append(...node.childNodes); node.append(em);
    }
  });
  root.querySelectorAll('table').forEach(table => {
    // GFM needs a header row; a blank header retains headerless tables without inventing labels.
    const first = table.rows[0];
    if (!first) { table.remove(); return; }
    if (table.querySelector('table, [rowspan]:not([rowspan="1"]), [colspan]:not([colspan="1"])')) {
      throw Error('合并单元格或嵌套表格无法直接转换，请先粘贴为纯文本。');
    }
    if (first.parentElement.tagName !== 'THEAD' && ![...first.cells].every(cell => cell.tagName === 'TH')) {
      const head = table.createTHead(), row = head.insertRow();
      for (const _ of first.cells) row.append(document.createElement('th'));
    }
    // The GFM plugin indexes childNodes, so discard inter-cell whitespace, not cell content.
    table.querySelectorAll('thead,tbody,tfoot,tr').forEach(node => [...node.childNodes].forEach(child => {
      if (child.nodeType === Node.TEXT_NODE && !child.textContent.trim()) child.remove();
    }));
  });
  const service = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-', codeBlockStyle: 'fenced', emDelimiter: '*', hr: '---', preformattedCode: true });
  service.use(tables);
  service.addRule('tableCell', { filter: ['th', 'td'], replacement: (content, node) => {
    const first = node === node.parentElement.firstElementChild;
    return `${first ? '| ' : ' '}${content.trim().replace(/\|/g, '\\|').replace(/\n+/g, ' ')} |`;
  } });
  service.addRule('strike', { filter: ['s', 'del', 'strike'], replacement: content => `~~${content}~~` });
  const result = service.turndown(root);
  if (result.length > articleBodyLimit) throw Error('文章正文不能超过 120000 字符。');
  return result;
}

export function attachArticleBodyEditor({ body, status }) {
  const undo = document.getElementById('article-format-undo');
  const pasteMode = document.getElementById('article-rich-paste');
  let snapshot = null;
  const syncControls = () => { undo.disabled = !snapshot; };
  const reset = () => { snapshot = null; undo.disabled = true; };
  body.addEventListener('input', reset);
  function replace(text, start = body.selectionStart, end = body.selectionEnd) {
    if (body.value.length - (end - start) + text.length > articleBodyLimit) throw Error('文章正文不能超过 120000 字符。');
    const before = { value: body.value, start: body.selectionStart, end: body.selectionEnd, scrollTop: body.scrollTop };
    body.setRangeText(text, start, end, 'end');
    body.dispatchEvent(new Event('input', { bubbles: true }));
    snapshot = before; undo.disabled = false;
    body.focus();
  }
  undo.addEventListener('click', () => {
    if (!snapshot) return;
    const before = snapshot;
    body.value = before.value;
    body.dispatchEvent(new Event('input', { bubbles: true }));
    body.focus(); body.setSelectionRange(before.start, before.end); body.scrollTop = before.scrollTop;
    status('已撤销排版操作。');
  });
  body.addEventListener('paste', event => {
    const html = event.clipboardData?.getData('text/html');
    if (body.disabled || !pasteMode.checked || !html) return;
    event.preventDefault();
    try {
      const converted = markdownFromClipboard(html);
      if (!converted.trim()) { status('未找到可粘贴的正文内容。', true); return; }
      replace(converted);
      status('已保留粘贴内容的结构。');
    } catch (error) { status(error.message, true); }
  });
  document.getElementById('article-format').addEventListener('click', () => {
    try {
      const formatted = formatArticleMarkdown(body.value);
      if (formatted === body.value) { status('当前排版已整齐。'); return; }
      replace(formatted, 0, body.value.length); status('已整理段落间距，正文内容未改写。');
    } catch (error) { status(error.message, true); }
  });
  for (const button of document.querySelectorAll('[data-body-action]')) {
    button.addEventListener('click', () => {
      const selected = body.value.slice(body.selectionStart, body.selectionEnd);
      const action = button.dataset.bodyAction;
      let text;
      if (action === 'bold') text = `**${selected || '重点文字'}**`;
      if (action === 'italic') text = `*${selected || '强调文字'}*`;
      if (action === 'link') text = `[${selected || '链接文字'}](https://)`;
      if (action === 'quote') text = '\n\n' + (selected || '引用文字').split('\n').map(line => '> ' + line).join('\n') + '\n\n';
      if (action === 'list') text = '\n\n' + (selected || '列表项').split('\n').map(line => '- ' + line).join('\n') + '\n\n';
      if (action === 'heading') text = `\n\n## ${selected || '小标题'}\n\n`;
      if (action === 'code') {
        const longest = Math.max(2, ...[...(selected || '').matchAll(/`+/g)].map(m => m[0].length));
        const fence = '`'.repeat(longest + 1);
        text = `\n\n${fence}\n${selected || '代码'}\n${fence}\n\n`;
      }
      try { if (text) replace(text); } catch (error) { status(error.message, true); }
    });
  }
  return { reset, syncControls, insertImage(url, alt = '') {
    const src = localArticleImage(url);
    if (!src) throw Error('图片地址无效，请重新上传。');
    replace(`\n\n![${alt.replace(/[\[\]\\]/g, '').replace(/\s+/g, ' ')}](${src})\n\n`);
  } };
}
