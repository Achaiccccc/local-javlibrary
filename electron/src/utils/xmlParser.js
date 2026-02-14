const xml2js = require('xml2js');
const fs = require('fs-extra');
const iconv = require('iconv-lite');
const jschardet = require('jschardet');
const js2xmlparser = require('js2xmlparser');
const path = require('path');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');

/**
 * 检测文件编码
 * @param {Buffer} buffer - 文件内容
 * @returns {string} - 编码名称
 */
function detectEncoding(buffer) {
  const detected = jschardet.detect(buffer);
  return detected.encoding || 'utf-8';
}

/**
 * 提取XML元素的文本内容
 * xml2js在解析有属性的元素时，会返回对象 { _: 'text', attr: 'value' }
 * 此函数用于提取文本内容，无论是字符串还是对象
 * @param {string|object} value - XML元素值
 * @returns {string} - 文本内容
 */
function extractText(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value._ !== undefined) {
    return String(value._ || '');
  }
  if (typeof value === 'object' && Array.isArray(value)) {
    // 如果是数组，取第一个元素
    return extractText(value[0]);
  }
  return String(value);
}

/**
 * 修复 XML 中未转义的 & 符号（如 URL 中的 &query=value）
 * XML 中 & 必须写成 &amp;，否则会报错 "Invalid character in entity name"
 * 仅替换「非实体」的 &，不破坏已有的 &amp; / &lt; / &#123; 等
 */
function fixUnescapedAmpersands(content) {
  return content.replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/gi, '&amp;');
}

/**
 * 修复混入元素内容中的 HTML/script 片段，避免被解析为 XML 标签导致 "Unexpected close tag"
 * 例如：<dmmid>..."])</script><script>...</dmmid> 中的 </script>、<script> 会破坏解析
 */
function fixScriptInContent(content) {
  return content
    .replace(/<\/script>/gi, '&lt;/script&gt;')
    .replace(/<script\s*>/gi, '&lt;script&gt;')
    .replace(/<script\s+/gi, '&lt;script ');
}

/**
 * 修复以数字开头的标签名（XML 规范要求标签名以字母/下划线/冒号开头），避免 "Unencoded <" 等解析错误
 * 例如：<7mmtvid>...</7mmtvid> 改为 <n_7mmtvid>...</n_7mmtvid>，解析后我们并不使用该字段
 */
function fixInvalidTagNames(content) {
  return content
    .replace(/<(\d[a-zA-Z0-9_-]*)\s*>/g, '<n_$1>')
    .replace(/<\/(\d[a-zA-Z0-9_-]*)\s*>/g, '</n_$1>');
}

/**
 * 解析NFO文件
 * @param {string} nfoPath - NFO文件路径
 * @returns {Promise<Object>} - 解析后的电影数据
 */
async function parseNfoFile(nfoPath) {
  try {
    // 读取文件
    const buffer = await fs.readFile(nfoPath);
    
    // 检测编码
    const encoding = detectEncoding(buffer);
    
    // 转换为UTF-8并去除 BOM，避免解析异常
    let content;
    if (encoding.toLowerCase() === 'utf-8') {
      content = buffer.toString('utf-8');
    } else {
      content = iconv.decode(buffer, encoding);
    }
    if (content.charCodeAt(0) === 0xFEFF) {
      content = content.slice(1);
    }
    // 修复 URL 等文本中未转义的 &，避免 "Invalid character in entity name" 解析错误
    content = fixUnescapedAmpersands(content);
    // 修复元素内容中混入的 </script>、<script> 等，避免 "Unexpected close tag"
    content = fixScriptInContent(content);
    // 修复以数字开头的标签名（如 <7mmtvid>），避免 "Unencoded <" 等解析错误
    content = fixInvalidTagNames(content);

    // 解析XML
    const parser = new xml2js.Parser({
      explicitArray: false,
      mergeAttrs: true,
      explicitRoot: false
    });
    
    const result = await parser.parseStringPromise(content);
    
    // 提取电影数据
    const movie = result.movie || result;
    
    // 处理演员（可能是数组或单个对象）
    let actors = [];
    if (movie.actor) {
      if (Array.isArray(movie.actor)) {
        actors = movie.actor.map(a => {
          if (typeof a === 'object' && a.name) {
            return extractText(a.name);
          }
          return extractText(a);
        });
      } else {
        if (typeof movie.actor === 'object' && movie.actor.name) {
          actors = [extractText(movie.actor.name)];
        } else {
          actors = [extractText(movie.actor)];
        }
      }
    }
    
    // 处理分类（可能是数组或单个字符串）
    let genres = [];
    if (movie.genre) {
      if (Array.isArray(movie.genre)) {
        genres = movie.genre.map(g => extractText(g));
      } else {
        genres = [extractText(movie.genre)];
      }
    }
    
    // 提取所有字段；识别码兼容 uniqueid 与 num 两种标签
    const title = extractText(movie.title);
    const code = extractText(movie.uniqueid) || extractText(movie.num) || '';
    const runtime = movie.runtime ? parseInt(extractText(movie.runtime)) : null;
    const premiered = movie.premiered ? extractText(movie.premiered) : null;
    const director = movie.director ? extractText(movie.director) : null;
    const studio = movie.studio ? extractText(movie.studio) : null;
    
    return {
      title: title || '',
      code: code || '',
      runtime: isNaN(runtime) ? null : runtime,
      premiered: premiered || null,
      director: director || null,
      studio: studio || null,
      actors: actors,
      genres: genres
    };
  } catch (error) {
    console.error(`解析NFO文件失败: ${nfoPath}`, error);
    throw error;
  }
}

/**
 * 写入NFO文件（全量覆盖，用于新建或不需要保留原有结构的场景）
 * @param {string} nfoPath - NFO文件路径
 * @param {Object} movieData - 电影数据对象
 * @returns {Promise<void>}
 */
async function writeNfoFile(nfoPath, movieData) {
  try {
    // 确保目录存在
    await fs.ensureDir(path.dirname(nfoPath));
    
    // 构建XML对象结构
    const xmlData = {
      '@': {
        'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
        'xmlns:xsd': 'http://www.w3.org/2001/XMLSchema'
      },
      title: movieData.title || '',
      runtime: movieData.runtime || null,
      uniqueid: {
        '@': {
          type: 'num',
          default: 'true'
        },
        '#': movieData.code || ''
      },
      genre: movieData.genres && movieData.genres.length > 0 
        ? (movieData.genres.length === 1 ? movieData.genres[0] : movieData.genres)
        : null,
      tag: movieData.genres && movieData.genres.length > 0
        ? movieData.genres.join(' / ')
        : null,
      director: movieData.director || '----',
      premiered: movieData.premiered || null,
      studio: movieData.studio || '----',
      actor: movieData.actors && movieData.actors.length > 0
        ? movieData.actors.map(name => ({ name }))
        : null
    };
    
    // 移除null值
    Object.keys(xmlData).forEach(key => {
      if (xmlData[key] === null || xmlData[key] === undefined) {
        delete xmlData[key];
      }
    });
    
    // 转换为XML字符串
    const xmlString = js2xmlparser.parse('movie', xmlData, {
      declaration: {
        include: true,
        encoding: 'UTF-8',
        standalone: 'yes'
      },
      format: {
        doubleQuotes: true,
        indent: '  '
      }
    });
    
    // 写入文件（使用UTF-8编码，带BOM以确保兼容性）
    const BOM = '\uFEFF';
    await fs.writeFile(nfoPath, BOM + xmlString, 'utf8');
    
    console.log(`NFO文件已写入: ${nfoPath}`);
  } catch (error) {
    console.error(`写入NFO文件失败: ${nfoPath}`, error);
    throw error;
  }
}

/**
 * 在根节点下设置或创建单个文本子节点（仅更新该标签内容，不删其他节点）
 * @param {Document} doc
 * @param {Element} root - <movie>
 * @param {string} tagName - 如 title, runtime
 * @param {string} value
 */
function setOrCreateTextChild(doc, root, tagName, value) {
  const list = root.getElementsByTagName(tagName);
  let el = list[0] || null;
  if (!el) {
    el = doc.createElement(tagName);
    root.appendChild(el);
  }
  const text = String(value ?? '');
  if (el.firstChild) el.firstChild.nodeValue = text;
  else el.appendChild(doc.createTextNode(text));
}

/**
 * 移除根节点下所有名为 tagName 的直接子元素（仅限直接子节点）
 * @param {Element} root
 * @param {string} tagName
 */
function removeDirectChildrenByTag(root, tagName) {
  const toRemove = [];
  for (let i = 0; i < root.childNodes.length; i++) {
    const n = root.childNodes[i];
    if (n.nodeType === 1 && n.tagName === tagName) toRemove.push(n);
  }
  toRemove.forEach(n => root.removeChild(n));
}

/** 根节点下子元素使用的缩进（与常见 NFO 格式一致） */
const INDENT = '\n  ';

/**
 * 在参考节点前插入新创建的一组节点，并在每个元素后加入换行+缩进以保持格式
 * @param {Document} doc
 * @param {Element} root
 * @param {string} parentTag - 如 'actor', 'genre', 'tag'
 * @param {string[]} values - 文本列表；对 actor 为 name 列表，会生成 <actor><name>x</name></actor>
 * @param {Node|null} insertBeforeNode - 在此节点前插入；null 则追加到 root 末尾
 */
function insertDirectChildren(doc, root, parentTag, values, insertBeforeNode) {
  if (!Array.isArray(values) || values.length === 0) return;
  const fragment = doc.createDocumentFragment();
  for (let i = 0; i < values.length; i++) {
    const val = values[i];
    const outer = doc.createElement(parentTag);
    if (parentTag === 'actor') {
      const nameEl = doc.createElement('name');
      nameEl.appendChild(doc.createTextNode(String(val)));
      outer.appendChild(nameEl);
    } else {
      outer.appendChild(doc.createTextNode(String(val)));
    }
    fragment.appendChild(outer);
    if (i < values.length - 1) fragment.appendChild(doc.createTextNode(INDENT));
  }
  fragment.appendChild(doc.createTextNode('\n'));
  if (insertBeforeNode) root.insertBefore(fragment, insertBeforeNode);
  else root.appendChild(fragment);
}

/**
 * 若 ref 为仅空白的文本节点，则从 root 中移除 ref 及其后连续的所有空白文本节点，避免留下大段空行
 */
function removeFollowingWhitespace(root, ref) {
  if (!ref || !ref.parentNode) return;
  let w = ref;
  while (w && w.nodeType === 3 && /^\s*$/.test(w.nodeValue)) {
    const next = w.nextSibling;
    root.removeChild(w);
    w = next;
  }
}

/**
 * 仅更新 NFO 中可编辑字段（基于 DOM：只改对应节点，其余原样保留）
 * @param {string} nfoPath - NFO 文件路径
 * @param {object} movieData - 编辑后的数据（与 writeNfoFile 的 movieData 结构一致）
 * @returns {Promise<void>}
 */
async function updateNfoFilePartial(nfoPath, movieData) {
  const buffer = await fs.readFile(nfoPath);
  const encoding = detectEncoding(buffer);
  const content = encoding.toLowerCase() === 'utf-8'
    ? buffer.toString('utf-8')
    : iconv.decode(buffer, encoding);

  const doc = new DOMParser().parseFromString(content, 'text/xml');
  const root = doc.documentElement;
  if (!root || root.tagName !== 'movie') {
    throw new Error('NFO 根节点不是 movie');
  }

  if (movieData.title !== undefined) setOrCreateTextChild(doc, root, 'title', movieData.title || '');
  if (movieData.runtime !== undefined) {
    if (movieData.runtime != null && movieData.runtime !== '') setOrCreateTextChild(doc, root, 'runtime', String(movieData.runtime));
    else {
      const list = root.getElementsByTagName('runtime');
      if (list[0]) root.removeChild(list[0]);
    }
  }
  if (movieData.code !== undefined) {
    const codeText = movieData.code != null && movieData.code !== '' ? String(movieData.code) : '';
    const hasUniqueid = root.getElementsByTagName('uniqueid')[0];
    const hasNum = root.getElementsByTagName('num')[0];
    if (hasUniqueid) {
      hasUniqueid.setAttribute('type', 'num');
      hasUniqueid.setAttribute('default', 'true');
      if (hasUniqueid.firstChild) hasUniqueid.firstChild.nodeValue = codeText;
      else hasUniqueid.appendChild(doc.createTextNode(codeText));
    }
    if (hasNum) {
      if (hasNum.firstChild) hasNum.firstChild.nodeValue = codeText;
      else hasNum.appendChild(doc.createTextNode(codeText));
    }
    if (!hasUniqueid && !hasNum) {
      const uid = doc.createElement('uniqueid');
      uid.setAttribute('type', 'num');
      uid.setAttribute('default', 'true');
      uid.appendChild(doc.createTextNode(codeText));
      const afterTitle = root.getElementsByTagName('title')[0];
      const frag = doc.createDocumentFragment();
      frag.appendChild(doc.createTextNode(INDENT));
      frag.appendChild(uid);
      frag.appendChild(doc.createTextNode(INDENT));
      if (afterTitle && afterTitle.nextSibling) root.insertBefore(frag, afterTitle.nextSibling);
      else root.appendChild(frag);
    }
  }
  if (movieData.director !== undefined) setOrCreateTextChild(doc, root, 'director', movieData.director == null || movieData.director === '' ? '----' : movieData.director);
  if (movieData.premiered !== undefined) {
    if (movieData.premiered != null && movieData.premiered !== '') setOrCreateTextChild(doc, root, 'premiered', movieData.premiered);
    else {
      const list = root.getElementsByTagName('premiered');
      if (list[0]) root.removeChild(list[0]);
    }
  }
  if (movieData.studio !== undefined) setOrCreateTextChild(doc, root, 'studio', movieData.studio == null || movieData.studio === '' ? '----' : movieData.studio);

  if (movieData.actors !== undefined) {
    const actors = Array.isArray(movieData.actors) ? movieData.actors.map(a => typeof a === 'string' ? a : (a && a.name) || '') : [];
    const firstActor = root.getElementsByTagName('actor')[0];
    const refActor = firstActor ? firstActor.nextSibling : null;
    removeDirectChildrenByTag(root, 'actor');
    insertDirectChildren(doc, root, 'actor', actors, refActor);
    removeFollowingWhitespace(root, refActor);
  }
  if (movieData.genres !== undefined) {
    const genres = Array.isArray(movieData.genres) ? movieData.genres : [];
    const firstGenre = root.getElementsByTagName('genre')[0];
    const refGenre = firstGenre ? firstGenre.nextSibling : null;
    removeDirectChildrenByTag(root, 'genre');
    insertDirectChildren(doc, root, 'genre', genres, refGenre);
    removeFollowingWhitespace(root, refGenre);
  }
  if (movieData.genres !== undefined) {
    const tags = Array.isArray(movieData.genres) ? movieData.genres : [];
    const firstTag = root.getElementsByTagName('tag')[0];
    const refTag = firstTag ? firstTag.nextSibling : null;
    removeDirectChildrenByTag(root, 'tag');
    insertDirectChildren(doc, root, 'tag', tags, refTag);
    removeFollowingWhitespace(root, refTag);
  }

  const xmlString = new XMLSerializer().serializeToString(doc);
  const BOM = '\uFEFF';
  await fs.ensureDir(path.dirname(nfoPath));
  await fs.writeFile(nfoPath, BOM + xmlString, 'utf8');
  console.log(`NFO文件已局部更新: ${nfoPath}`);
}

/**
 * 从 NFO 文件中读取指定标签的文本内容（用于详情页简介等）
 * @param {string} nfoPath - NFO 文件完整路径
 * @param {string} tagName - 标签名，如 'originalplot'
 * @returns {Promise<string|null>} - 标签文本内容，不存在或解析失败则返回 null
 */
async function readNfoTagContent(nfoPath, tagName) {
  try {
    const buffer = await fs.readFile(nfoPath);
    const encoding = detectEncoding(buffer);
    let content =
      encoding.toLowerCase() === 'utf-8'
        ? buffer.toString('utf-8')
        : iconv.decode(buffer, encoding);
    if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);
    content = fixUnescapedAmpersands(content);
    content = fixScriptInContent(content);
    content = fixInvalidTagNames(content);

    const parser = new xml2js.Parser({
      explicitArray: false,
      mergeAttrs: true,
      explicitRoot: false
    });
    const result = await parser.parseStringPromise(content);
    const movie = result.movie || result;
    const value = movie[tagName];
    if (value == null) return null;
    return extractText(value).trim() || null;
  } catch (error) {
    console.error(`读取NFO标签失败: ${nfoPath} [${tagName}]`, error);
    return null;
  }
}

module.exports = {
  parseNfoFile,
  readNfoTagContent,
  detectEncoding,
  writeNfoFile,
  updateNfoFilePartial
};
