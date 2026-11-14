// ==UserScript==
// @name         小雅粘粘粘
// @namespace    http://tampermonkey.net/
// @author       Qy
// @version      2.1
// @description  小雅平台的答题和复习助手：把题目整理给 AI、逐题保存答案、查看每题得分，整门课的作业一次导出成 PDF 或 DOC
// @match        *://*.ai-augmented.com/*
// @require      https://scriptcat.org/lib/6742/14.1.0/markdown-it.js?sha384-wLhprpjsmjc/XYIcF+LpMxd8yS1gss6jhevOp6F6zhiIoFK6AmHtm4bGKtehTani
// @resource     mathjax https://scriptcat.org/lib/6741/3.2.2/MathJax%203.2.2.js?sha384-4kE/rQ11E8xT9QgrCBTyvenkuPfQo8rXYQvJZuMgxyPOoUfpatjQPlgdv6V5yhUK
// @grant        GM_setClipboard
// @grant        GM_xmlhttpRequest
// @grant        GM_getResourceText
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @connect      *.ai-augmented.com
// @connect      *.aliyuncs.com
// @connect      xiaoya.qyovo.com
// @icon         data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCI+PHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiByeD0iMTYiIGZpbGw9IiNlOGVkZmMiLz48cG9seWdvbiBwb2ludHM9IjI1LDM1IDU4LDM1IDU0LjUsMzkuNSA1OCw0NCAyNSw0NCIgZmlsbD0iIzJmNTRkNCIvPjxjaXJjbGUgY3g9IjI1IiBjeT0iMjciIHI9IjE3IiBmaWxsPSIjMmY1NGQ0Ii8+PGNpcmNsZSBjeD0iMjUiIGN5PSIyNyIgcj0iMTIuNSIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjNmQ4YmVjIiBzdHJva2Utd2lkdGg9IjEuNSIvPjxjaXJjbGUgY3g9IjI1IiBjeT0iMjciIHI9IjguNSIgZmlsbD0iI2U4ZWRmYyIvPjwvc3ZnPg==
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    const NAME = '小雅粘粘粘';
    const VERSION = '2.1';
    const NOTICE_API = 'https://xiaoya.qyovo.com/notice';
    const NOTICE_CHANNEL = 'zhanzhanzhan';
    const PAPER_API = '/api/jx-iresource/survey/course/queryStuPaper/v2';
    const GROUP_API = '/api/jx-iresource/group/queryGroup/';
    const RESOURCES_API = '/api/jx-iresource/resource/queryCourseResources/v2?group_id=';
    const COURSES_API = '/api/jx-iresource/group/student/groups?time_flag=1';
    const WATCHED_API = /queryStuPaper\/v2|group\/queryGroup\//;
    const TYPE = { 1: '单选题', 2: '多选题', 4: '填空题', 5: '判断题', 6: '简答题', 7: '附件题', 9: '题组', 10: '编程题', 11: '排序题', 13: '匹配题' };
    const TASK_KIND = { 2: '作业', 3: '练习', 4: '测验' };
    const PRINT_TIP = '在打印窗口里选择「另存为 PDF」，文字可以复制和搜索。';

    const page = unsafeWindow;
    const rawFetch = page.fetch;

    let paper = null;
    let notice = null;
    const courses = {};

    const prefs = Object.assign({ theme: '', welcomed: false, right: 24, top: 96, header: 'both', withAnswers: false, answerAt: 'inline', pack: 'one', fmt: 'pdf', seen: '' }, GM_getValue('prefs', {}));
    const savePrefs = () => GM_setValue('prefs', prefs);

    function dropLegacyKeys() {
        try {
            Object.keys(page.localStorage)
                .filter(key => /^xy_(magic_box_position_|zhanzhanzhan_notice_|homework_export_options_|course_name_v18_)/.test(key))
                .forEach(key => page.localStorage.removeItem(key));
        } catch (e) { }
    }

    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const num = value => (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) ? null : Number(value);
    const pad2 = n => String(n).padStart(2, '0');
    const fileSafe = value => String(value || '课程作业').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || '课程作业';

    function stamp() {
        const d = new Date();
        return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}_${pad2(d.getHours())}${pad2(d.getMinutes())}`;
    }

    function isNewer(latest, current) {
        const a = String(latest || '').split('.').map(Number);
        const b = String(current || '').split('.').map(Number);
        for (let i = 0; i < Math.max(a.length, b.length); i++) {
            if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
        }
        return false;
    }

    function parseJson(value) {
        if (typeof value !== 'string' || /^\s*\d+\s*$/.test(value)) return value;
        try { return JSON.parse(value); } catch (e) { return value; }
    }

    function getToken() {
        let fallback = '';
        for (const cookie of document.cookie.split(/;\s*/)) {
            const i = cookie.indexOf('=');
            if (i < 0) continue;
            const name = cookie.slice(0, i);
            let value = cookie.slice(i + 1);
            try { value = decodeURIComponent(value); } catch (e) { }
            if (name === 'prd-access-token') return value;
            if (!fallback && name.endsWith('access-token')) fallback = value;
        }
        return fallback;
    }

    async function api(path, init = {}) {
        const token = getToken();
        const method = init.method || 'GET';
        if (!token) {
            log('接口', method, path, '没有登录 token');
            throw new Error('没读到登录信息，刷新页面后再试');
        }
        const t0 = Date.now();
        let res;
        try {
            res = await rawFetch.call(page, location.origin + path, {
                ...init,
                credentials: 'include',
                headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=UTF-8' },
            });
        } catch (e) {
            log('接口', method, path, '网络错误', e, `${Date.now() - t0}ms`);
            throw e;
        }
        let data = null;
        try { data = await res.json(); } catch (e) { }
        log('接口', method, path, res.status, `${Date.now() - t0}ms`, apiSummary(data));
        if (!res.ok || !data || data.success === false) throw new Error(data?.message || `请求失败（${res.status}）`);
        return data;
    }

    function apiSummary(data) {
        if (!data) return '返回不是 JSON';
        if (data.success === false) return `失败：code=${data.code} ${data.message || ''}`;
        const d = data.data;
        if (Array.isArray(d)) return `${d.length} 条`;
        if (Array.isArray(d?.questions)) return `题目 ${d.questions.length} 道`;
        return d && typeof d === 'object' ? `字段：${Object.keys(d).slice(0, 12).join(',')}` : `data 是 ${d === null ? 'null' : typeof d}`;
    }

    function gmRequest(options) {
        return new Promise((resolve, reject) => GM_xmlhttpRequest({
            timeout: 20000,
            ...options,
            onload: res => (res.status >= 200 && res.status < 300) ? resolve(res) : reject(new Error(`请求失败（${res.status}）`)),
            onerror: () => reject(new Error('网络请求失败')),
            ontimeout: () => reject(new Error('网络请求超时')),
        }));
    }

    const LOG_MAX = 250000;
    const LOG_COPY = 400;
    let logAll = GM_getValue('log', '');
    let logTimer = null;
    let logLast = '';
    let logRepeat = 0;

    const when = ms => {
        if (!Number.isFinite(ms)) return '-';
        const d = new Date(ms);
        return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
    };

    function logStr(v) {
        if (v instanceof Error) return v.message;
        if (v && typeof v === 'object') {
            try { return JSON.stringify(v).slice(0, 300); } catch (e) { return String(v); }
        }
        return String(v);
    }

    function log(...parts) {
        const text = parts.filter(v => v !== '' && v !== null && v !== undefined).map(logStr).join(' ');
        if (text === logLast) {
            logRepeat++;
            return;
        }
        const now = Date.now();
        const at = `${when(now)}.${String(now % 1000).padStart(3, '0')}`;
        if (logRepeat) logAll += `${at} ↑ 上一条又重复了 ${logRepeat} 次\n`;
        logLast = text;
        logRepeat = 0;
        logAll += `${at} ${text}\n`;
        if (!logTimer) logTimer = setTimeout(saveLog, 1000);
    }

    function saveLog() {
        clearTimeout(logTimer);
        logTimer = null;
        if (logAll.length > LOG_MAX) logAll = logAll.slice(logAll.indexOf('\n', logAll.length - LOG_MAX * 0.8) + 1);
        GM_setValue('log', logAll);
        return logAll;
    }

    function logText(last) {
        const lines = saveLog();
        return [
            `${NAME} v${VERSION} 诊断日志`,
            `导出：${new Date().toString()}`,
            `页面：${location.host}${location.pathname}`,
            `浏览器：${navigator.userAgent}`,
            `脚本管理器：${typeof GM_info === 'object' ? `${GM_info.scriptHandler || '?'} ${GM_info.version || ''}` : '读不到'}`,
            `时区：${Intl.DateTimeFormat().resolvedOptions().timeZone}，窗口 ${innerWidth}×${innerHeight}，页面 ${document.visibilityState}`,
            `设置：${Object.entries(prefs).filter(([key]) => key !== 'seen').map(([key, value]) => `${key}=${value}`).join(' ')}`,
            `公告：${notice ? (notice.error ? '加载失败' : `v${notice.version} ${notice.updatedAt}`) : '未加载'}`,
            `这份作业：${paper ? paperLine(paper) : '无'}`,
            ...view.status(),
            '',
            '',
        ].join('\n') + (last ? lines.trimEnd().split('\n').slice(-last).join('\n') : lines);
    }

    function mediaOf(data) {
        const type = String(data?.type || '').toUpperCase();
        if (type.includes('IMAGE') || type === 'IMG' || data?.src) {
            const src = data.src || data.imageUrl || data.url;
            return src ? { type: 'image', src } : null;
        }
        if (type.includes('TEX') || type.includes('MATH') || type.includes('FORMULA')) {
            const tex = String(data.teX || data.tex || data.latex || '').trim();
            return tex ? { type: 'math', value: tex, display: data.display === true } : null;
        }
        return undefined;
    }

    function rich(segments) {
        return { segments, text: plainText(segments) };
    }

    function parseRich(raw) {
        const doc = typeof raw === 'string' ? parseJson(raw) : raw;
        if (!doc || typeof doc !== 'object' || !Array.isArray(doc.blocks)) {
            const text = typeof raw === 'string' ? raw.replace(/^"|"$/g, '').trim()
                : (raw && typeof raw === 'object') ? JSON.stringify(raw) : String(raw ?? '').trim();
            return rich(text ? [{ type: 'text', value: text }] : []);
        }
        const entities = doc.entityMap || {};
        const segs = [];
        const text = value => { if (value) segs.push({ type: 'text', value }); };
        doc.blocks.forEach(block => {
            if (!block) return;
            if (segs.length && segs[segs.length - 1].type !== 'break') segs.push({ type: 'break' });
            const atomic = block.type === 'atomic' && mediaOf(block.data);
            if (atomic) { segs.push(atomic); return; }
            const str = String(block.text || '');
            const ranges = (block.entityRanges || [])
                .map(r => ({ start: Math.max(0, Number(r.offset) || 0), length: Math.max(0, Number(r.length) || 0), entity: entities[r.key] }))
                .filter(r => r.entity)
                .sort((a, b) => a.start - b.start);
            let cursor = 0;
            ranges.forEach(r => {
                const start = Math.min(r.start, str.length);
                const end = Math.min(start + r.length, str.length);
                if (start < cursor) return;
                text(str.slice(cursor, start));
                const media = mediaOf({ ...r.entity.data, type: r.entity.type || r.entity.data?.type });
                if (media) segs.push(media);
                else if (media === undefined) text(str.slice(start, end));
                cursor = end;
            });
            text(str.slice(cursor));
        });
        while (segs.length && segs[segs.length - 1].type === 'break') segs.pop();
        return rich(segs);
    }

    function plainText(segments) {
        return segments.map(s => s.type === 'break' ? '\n'
            : s.type === 'image' ? '[图片]'
            : s.type === 'math' ? (s.display ? `$$${s.value}$$` : `$${s.value}$`)
            : s.value).join('')
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    function sortByIds(items, order) {
        const list = Array.isArray(items) ? items.filter(Boolean) : [];
        const ids = String(order || '').split(',').map(s => s.trim()).filter(Boolean);
        if (!ids.length) return list;
        const byId = new Map(list.map(item => [String(item.id), item]));
        const sorted = ids.map(id => byId.get(id)).filter(Boolean);
        return sorted.concat(list.filter(item => !sorted.includes(item)));
    }

    function addImages(images, content, label) {
        content.segments.forEach(s => {
            if (s.type === 'image' && !images.some(img => img.src === s.src && img.label === label)) images.push({ src: s.src, label });
        });
    }

    function buildQuestion(raw, index, images) {
        const type = Number(raw.type);
        const title = parseRich(raw.title);
        const items = sortByIds(raw.answer_items, raw.answer_items_sort);
        const q = { index, id: raw.id, type, label: TYPE[type] || '其他题型', score: num(raw.score), title, items, options: [], left: [], right: [] };
        addImages(images, title, `第 ${index} 题 · 题干`);
        const option = (item, letter) => {
            const content = parseRich(item.value);
            addImages(images, content, `第 ${index} 题 · 选项 ${letter}`);
            return { id: item.id, letter, content, text: content.text, correct: item.answer_checked === 2, answer: item.answer };
        };
        if (type === 1 || type === 2 || type === 5) {
            q.options = items.map((item, i) => option(item, String.fromCharCode(65 + i)));
            if (type === 5) q.options.forEach(o => { if (!o.text) { o.text = o.letter === 'A' ? '正确' : '错误'; o.content = rich([{ type: 'text', value: o.text }]); } });
        } else if (type === 13) {
            q.left = items.filter(item => item.is_target_opt !== true).map((item, i) => option(item, String.fromCharCode(65 + i)));
            q.right = items.filter(item => item.is_target_opt === true).map((item, i) => option(item, String.fromCharCode(97 + i)));
        } else if (type === 10) {
            q.code = String(raw.program_setting?.code_answer ?? '').trim();
        }
        return q;
    }

    function buildPaper(data, ids) {
        const images = [];
        const sections = [];
        const questions = [];
        (data.questions || []).forEach(raw => {
            const subs = sortByIds(raw.subQuestions || raw.sub_questions, raw.sub_questions_sort);
            const group = Number(raw.type) === 9 && subs.length > 0;
            const section = { title: group ? parseRich(raw.title) : null, questions: [] };
            if (group) addImages(images, section.title, `题组材料（第 ${questions.length + 1} 题起）`);
            (group ? subs : [raw]).forEach(item => {
                const q = buildQuestion(item, questions.length + 1, images);
                section.questions.push(q);
                questions.push(q);
            });
            sections.push(section);
        });
        const p = {
            ...ids,
            key: [ids.groupId, ids.nodeId, ids.paperId].join(':'),
            title: String(data.title || '课程作业'),
            total: num(data.total_score),
            showAnswer: data.publish_record?.is_show_answer === true,
            sections,
            questions,
            images,
        };
        p.result = buildResult(data, p);
        const record = data.answer_record;
        const publish = data.publish_record;
        log('题目', paperLine(p), `原始数据：questions ${(data.questions || []).length} 条 is_sampling=${data.is_sampling} question_random=${data.question_random} paper_mode=${data.paper_mode}`,
            `作答记录=${record ? `status ${record.status}，answers ${(record.answers || []).length} 条` : '无'}`,
            `发布=${publish ? `${when(Date.parse(publish.start_time))} 到 ${when(Date.parse(publish.end_time))}` : '无'}`);
        return p;
    }

    function paperLine(p) {
        const tally = (list, key) => Object.entries(list.reduce((n, x) => { n[key(x)] = (n[key(x)] || 0) + 1; return n; }, {})).map(([name, n]) => `${name} ${n}`).join('、');
        const r = p.result;
        return `「${p.title}」paper=${p.paperId} node=${p.nodeId} ${p.questions.length} 题（${tally(p.questions, q => q.label)}）题组 ${p.sections.filter(s => s.title).length} 个 图片 ${p.images.length} 张 `
            + `${r ? `已交卷 ${r.score ?? '-'}/${r.total ?? '-'}（${tally(r.rows, row => STATE_LABEL[row.state])}）` : '没有成绩'} 公开答案=${p.showAnswer ? `是，取到标准答案 ${p.questions.filter(q => standardAnswer(q)).length} 题` : '否'}`;
    }

    function answerText(value) {
        const v = parseJson(value);
        if (v === null || v === undefined) return '';
        if (typeof v === 'object' && Array.isArray(v.blocks)) return parseRich(v).text;
        if (typeof v === 'object') return Object.values(v).map(answerText).filter(Boolean).join('；');
        return String(v).trim();
    }

    function idsOf(value) {
        const v = parseJson(value);
        if (Array.isArray(v)) return v.map(x => String(x).trim()).filter(Boolean);
        return v === null || v === undefined ? [] : String(v).split(/[,，、\s]+/).filter(Boolean);
    }

    function formatMatch(q, value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return answerText(value);
        const right = new Map(q.right.map(r => [String(r.id), r]));
        return q.left.map(l => {
            const picked = idsOf(value[l.id]).map(id => right.get(id)).map(r => r ? `${r.letter}. ${r.text}` : '').filter(Boolean);
            return picked.length ? `${l.letter}. ${l.text} → ${picked.join('、')}` : '';
        }).filter(Boolean).join('\n');
    }

    function formatAnswer(q, value) {
        if (q.type === 7) return '附件题';
        if (value === null || value === undefined || value === '') return '';
        if ([1, 2, 5].includes(q.type)) {
            return idsOf(value).map(id => q.options.find(o => String(o.id) === id)).map(o => o ? `${o.letter}. ${o.text}` : '').filter(Boolean).join('；');
        }
        if (q.type === 4) {
            const v = parseJson(value);
            if (!v || typeof v !== 'object' || Array.isArray(v)) return answerText(v);
            return q.items.map((item, i) => `空${i + 1}：${answerText(v[item.id]) || '未填'}`).join('；');
        }
        if (q.type === 13) return formatMatch(q, parseJson(value));
        if (q.type === 10) return String(parseJson(value)?.code ?? '').trim();
        return answerText(value);
    }

    function standardAnswer(q) {
        if ([1, 2, 5].includes(q.type)) return q.options.filter(o => o.correct).map(o => `${o.letter}. ${o.text}`).join('；');
        if (q.type === 4) return q.items.map((item, i) => answerText(item.answer) ? `空${i + 1}：${answerText(item.answer)}` : '').filter(Boolean).join('；');
        if (q.type === 6) return answerText(q.items[0]?.answer);
        if (q.type === 13) {
            const map = {};
            q.left.forEach(l => { if (l.answer) map[l.id] = l.answer; });
            return formatMatch(q, map);
        }
        if (q.type === 10) return q.code;
        return '';
    }

    function resultState(record, q) {
        if (!record) return 'none';
        const score = num(record.score);
        const correct = num(record.correct);
        if (correct === 2 || (score !== null && q.score > 0 && score >= q.score)) return 'ok';
        if (score > 0) return 'part';
        if (correct === 1 || score === 0) return 'bad';
        return 'pending';
    }

    function buildResult(data, p) {
        const record = data.answer_record;
        if (!record || Number(record.status) !== 2) return null;
        const byId = new Map((record.answers || []).map(a => [String(a.question_id), a]));
        const rows = p.questions.map(q => {
            const answer = byId.get(String(q.id));
            const state = resultState(answer, q);
            const mine = formatAnswer(q, answer?.answer);
            return { q, state, score: num(answer?.score), mine, standard: p.showAnswer ? standardAnswer(q) : '', confirmed: state === 'ok' ? mine : '' };
        });
        return { score: num(record.actual_score ?? record.score), total: p.total, rows };
    }

    function exportAnswers(p) {
        const map = new Map();
        p.questions.forEach((q, i) => {
            const answer = (p.showAnswer && standardAnswer(q)) || p.result?.rows[i].confirmed;
            if (answer) map.set(q.index, answer);
        });
        return map;
    }

    function questionLines(q, indent) {
        const lines = [];
        const list = items => items.forEach(o => lines.push(`${indent}${o.letter}. ${o.text}`));
        if (q.options.length) list(q.options);
        else if (q.type === 4) lines.push(`${indent}(本题共 ${q.items.length} 个填空)`);
        else if (q.type === 7) lines.push(`${indent}附件题无需回答。`);
        else if (q.type === 13) {
            lines.push(`${indent}左侧：`);
            list(q.left);
            lines.push('', `${indent}右侧候选：`);
            list(q.right);
        }
        return lines;
    }

    function buildPrompt(p) {
        const course = getCourse(p.groupId);
        const lines = ['【小雅粘粘粘：AI 作答模板】'];
        if (course) lines.push(`课程：${course}`);
        lines.push(
            '请根据以下题目，严格按照指定格式输出答案，不要输出解析、注释或额外说明。',
            '【输出格式要求】',
            '单选/判断题格式：[题号] => [大写字母] (如 1 => A)',
            '多选题格式：[题号] => [大写字母] (多选请用英文逗号分隔，如 2 => A,C)',
            '填空题格式：[题号] => [空1] | [空2] (如 3 => const | let)',
            '简答题格式：[题号] => [完整文字答案]',
            '匹配题格式：[题号] => A:a,d | B:b,c',
            '附件题无需回答。',
            '',
            '--- 以下为考试内容 ---',
            '',
        );
        p.sections.forEach(section => {
            if (section.title?.text) lines.push('【题组】', section.title.text, '');
            section.questions.forEach(q => lines.push(`${q.index}. ${q.title.text} [${q.label}]`, ...questionLines(q, '   '), ''));
        });
        return lines.join('\n');
    }

    function buildHomeworkText(p) {
        const course = getCourse(p.groupId);
        const head = { both: [p.title, course && `课程：${course}`], course: [course && `课程：${course}`], paper: [p.title], none: [] }[prefs.header].filter(Boolean);
        const lines = head.length ? [...head, ''] : [];
        const answers = prefs.withAnswers ? exportAnswers(p) : new Map();
        p.sections.forEach(section => {
            if (section.title?.text) lines.push(section.title.text, '');
            section.questions.forEach(q => {
                lines.push(`${q.index}. ${q.label}`, q.title.text, ...questionLines(q, ''));
                if (answers.has(q.index) && prefs.answerAt === 'inline') lines.push(`答案：${answers.get(q.index)}`);
                lines.push('');
            });
        });
        if (answers.size && prefs.answerAt === 'end') lines.push('答案', ...[...answers].map(([n, a]) => `${n}. ${a}`));
        return lines.join('\n').trim();
    }

    function parseAnswers(text) {
        const blocks = new Map();
        let current = null;
        String(text || '').split(/\r?\n/).forEach(line => {
            if (/^\s*```/.test(line)) return;
            const m = line.match(/^\s*(?:\*\*)?\s*(\d+)\s*(?:\*\*)?\s*(?:=>|＝>|⇒)\s*(.*)$/);
            if (m) {
                current = Number(m[1]);
                blocks.set(current, [m[2]]);
            } else if (current !== null) {
                blocks.get(current).push(line.trimEnd());
            }
        });
        const answers = new Map();
        blocks.forEach((lines, n) => {
            const value = lines.join('\n').trim();
            if (value) answers.set(n, value);
        });
        return answers;
    }

    function richTextAnswer(text) {
        return JSON.stringify({
            blocks: String(text).split(/\r?\n/).map((line, i) => ({ key: `ans-${i}`, text: line, type: 'unstyled', depth: 0, inlineStyleRanges: [], entityRanges: [], data: {} })),
            entityMap: {},
        });
    }

    const JUDGE_TRUE = /^(正确|对|是|√|✓|✔|T|TRUE)(?![A-Za-z])/i;
    const JUDGE_FALSE = /^(错误|错|否|×|✗|✘|X|F|FALSE)(?![A-Za-z])/i;

    function payloadFor(q, text) {
        if (q.type === 7) return { skip: true };
        if ([1, 2, 5].includes(q.type)) {
            let picked;
            if (q.type === 5 && JUDGE_TRUE.test(text)) picked = [q.options.find(o => /^(正确|对)$/.test(o.text)) || q.options[0]];
            else if (q.type === 5 && JUDGE_FALSE.test(text)) picked = [q.options.find(o => /^(错误|错)$/.test(o.text)) || q.options[1]];
            else {
                const head = (text.match(/^[A-Za-z\s,，、;；]+/) || [''])[0];
                const letters = [...new Set(head.replace(/[^A-Za-z]/g, '').toUpperCase())];
                if (!letters.length) return { error: '没写选项字母' };
                const missing = letters.filter(l => !q.options.some(o => o.letter === l));
                if (missing.length) return { error: `没有选项 ${missing.join('、')}` };
                picked = letters.map(l => q.options.find(o => o.letter === l));
            }
            if (picked.some(o => !o)) return { error: '选项读取失败' };
            if (q.type !== 2 && picked.length > 1) return { error: `${q.label}只能选一个` };
            return { payload: picked.map(o => o.id) };
        }
        if (q.type === 4) {
            const parts = q.items.length > 1 ? text.split(/[|｜]/).map(s => s.trim()) : [text.trim()];
            if (parts.length > q.items.length) return { error: `只有 ${q.items.length} 个空，答案写了 ${parts.length} 个` };
            const blanks = {};
            q.items.forEach((item, i) => { if (parts[i]) blanks[item.id] = parts[i]; });
            return Object.keys(blanks).length ? { payload: [blanks] } : { error: '没有填写内容' };
        }
        if (q.type === 6) return { payload: [richTextAnswer(text)] };
        if (q.type === 13) {
            const left = new Map(q.left.map(l => [l.letter, l]));
            const right = new Map(q.right.map(r => [r.letter, r]));
            const pairs = {};
            for (const part of text.split(/[|｜;；\n]+/).map(s => s.trim()).filter(Boolean)) {
                const m = part.match(/^([A-Za-z])\s*(?:=>|->|[:：=])\s*(.+)$/);
                if (!m) return { error: `看不懂「${part}」，应写成 A:a,b` };
                const l = left.get(m[1].toUpperCase());
                if (!l) return { error: `左侧没有 ${m[1].toUpperCase()}` };
                const letters = m[2].split(/[,，、\s]+/).map(s => s.replace(/[.。]/g, '').toLowerCase()).filter(Boolean);
                const bad = letters.filter(x => !right.has(x));
                if (bad.length) return { error: `右侧没有 ${bad.join('、')}` };
                pairs[l.id] = letters.map(x => right.get(x).id).join(',');
            }
            return Object.keys(pairs).length ? { payload: [pairs] } : { error: '没有匹配内容' };
        }
        return { skip: true };
    }

    function checkAnswers(p, text) {
        const answers = parseAnswers(text);
        const jobs = [];
        const issues = [];
        const ok = new Set();
        const bad = new Set();
        answers.forEach((value, n) => {
            const q = p.questions[n - 1];
            if (!q) { issues.push({ n, message: '没有这道题' }); return; }
            const r = payloadFor(q, value);
            if (r.error) { issues.push({ n, message: r.error }); bad.add(n); }
            else if (r.payload) { jobs.push({ q, payload: r.payload }); ok.add(n); }
        });
        const missing = p.questions.filter(q => q.type !== 7 && !answers.has(q.index)).map(q => q.index);
        return { jobs, issues, ok, bad, missing };
    }

    async function fetchRecordId(p) {
        const data = await api(`/api/jx-iresource/survey/course/task/flow/v2?node_id=${encodeURIComponent(p.nodeId)}&group_id=${encodeURIComponent(p.groupId)}`);
        const id = data.data?.task_flow_record?.[0]?.answer_record_id || data.data?.task_flow_template?.[0]?.answer_record_id;
        if (!id) throw new Error('没读到作答记录，刷新页面后再试');
        return id;
    }

    async function saveAnswers(p, jobs, onProgress) {
        log('保存', `开始，${jobs.length} 题：${jobs.map(job => `${job.q.index}(${job.q.label})`).join(' ')}`);
        const recordId = await fetchRecordId(p);
        const failed = [];
        for (let i = 0; i < jobs.length; i++) {
            const { q, payload } = jobs[i];
            try {
                await api('/api/jx-iresource/survey/answer', {
                    method: 'POST',
                    body: JSON.stringify({ record_id: recordId, question_id: q.id, answer: payload, ext_answer: '', group_id: p.groupId, paper_id: p.paperId, is_try: 0 }),
                });
            } catch (e) {
                log('保存', `第 ${q.index} 题（${q.label}）失败`, e);
                failed.push({ n: q.index, message: `保存失败：${e.message}` });
            }
            onProgress(i + 1, jobs.length);
        }
        log('保存', `结束，成功 ${jobs.length - failed.length} 题，失败 ${failed.length} 题`);
        return failed;
    }

    function getCourse(groupId) {
        if (!groupId) return '';
        if (!(groupId in courses)) courses[groupId] = GM_getValue(`course:${groupId}`, '');
        return courses[groupId];
    }

    function setCourse(groupId, name) {
        const value = String(name || '').trim();
        if (!groupId || getCourse(groupId) === value) return;
        courses[groupId] = value;
        GM_setValue(`course:${groupId}`, value);
        view.course();
    }

    async function loadCourse(groupId) {
        if (!groupId || getCourse(groupId)) return;
        try {
            const data = await api(GROUP_API + encodeURIComponent(groupId));
            setCourse(groupId, data.data?.name);
        } catch (e) {
            log('课程名', '读取失败', e);
            console.warn(`[${NAME}] 课程名读取失败`, e);
        }
    }

    function onCaptured(url, json) {
        const at = new URL(url, location.origin);
        try {
            log('旁听', at.pathname + at.search, apiSummary(json));
            if (url.includes(PAPER_API)) onPaper(url, json);
            else {
                const groupId = decodeURIComponent(at.pathname.split(GROUP_API)[1] || '').split('/')[0];
                log('课程名', groupId, json?.data?.name ? `「${json.data.name}」` : '返回里没有课程名');
                if (json?.data?.name) setCourse(groupId, json.data.name);
            }
        } catch (e) {
            log('旁听', '处理失败', at.pathname, e);
            console.error(`[${NAME}] 接口数据处理失败`, e);
        }
    }

    function onPaper(url, json) {
        const data = json?.data;
        if (!data || !Array.isArray(data.questions)) {
            log('旁听', '题目接口的返回里没有题目，不处理');
            return;
        }
        const params = new URL(url, location.origin).searchParams;
        const p = buildPaper(data, {
            groupId: params.get('group_id') || String(data.group_id || ''),
            nodeId: params.get('node_id') || '',
            paperId: params.get('paper_id') || String(data.paper_id || data.id || ''),
        });
        setPaper(p);
        loadCourse(p.groupId);
        console.log(`[${NAME}] 已读取 ${p.questions.length} 道题`);
    }

    function setPaper(p) {
        paper = p;
        view.paper();
    }

    function hookRequests() {
        const urls = new WeakMap();
        const proto = page.XMLHttpRequest.prototype;
        const rawOpen = proto.open;
        const rawSend = proto.send;
        const readXhr = async xhr => {
            if (xhr.responseType === 'json') return xhr.response;
            if (xhr.responseType === 'blob') return JSON.parse(await xhr.response.text());
            if (xhr.responseType === 'arraybuffer') return JSON.parse(new TextDecoder().decode(xhr.response));
            return JSON.parse(xhr.responseText);
        };
        proto.open = function (method, url) {
            urls.set(this, String(url));
            return rawOpen.apply(this, arguments);
        };
        proto.send = function () {
            const url = urls.get(this);
            if (url && WATCHED_API.test(url)) {
                this.addEventListener('load', () => readXhr(this).then(json => onCaptured(url, json), e => {
                    log('旁听', '解析失败', url.split('?')[0], `responseType=${this.responseType || '空'}`, e);
                    console.warn(`[${NAME}] 解析接口数据失败`, e);
                }));
            }
            return rawSend.apply(this, arguments);
        };
        page.fetch = function (input) {
            const promise = rawFetch.apply(this, arguments);
            const url = typeof input === 'string' ? input : (input?.url || String(input));
            if (WATCHED_API.test(url)) promise.then(res => res.clone().json()).then(json => onCaptured(url, json), e => log('旁听', '解析失败', url.split('?')[0], e));
            return promise;
        };
    }

    function watchRoute() {
        const check = () => setTimeout(() => {
            log('路由', location.pathname);
            if (paper && ![paper.groupId, paper.nodeId].filter(Boolean).every(id => location.href.includes(id))) {
                log('题目', `离开了「${paper.title}」的页面，清空`);
                setPaper(null);
            }
            view.route();
        }, 80);
        ['pushState', 'replaceState'].forEach(name => {
            const raw = page.history[name];
            page.history[name] = function () {
                const result = raw.apply(this, arguments);
                check();
                return result;
            };
        });
        page.addEventListener('popstate', check);
    }

    function blobToDataUrl(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
        });
    }

    const imageName = src => String(src).split('?')[0].split('/').slice(-2).join('/');

    async function fetchImage(src) {
        const t0 = Date.now();
        try {
            const blob = (await gmRequest({ method: 'GET', url: src, responseType: 'blob', withCredentials: true })).response;
            log('图片', imageName(src), blob?.type || '没有类型', `${Math.round((blob?.size || 0) / 1024)}KB`, `${Date.now() - t0}ms`);
            return blob;
        } catch (e) {
            log('图片', imageName(src), '读取失败', e, `${Date.now() - t0}ms`);
            throw e;
        }
    }

    async function inlineImages(images, map = new Map()) {
        const todo = [...new Set(images.map(img => img.src))].filter(src => !map.has(src));
        if (!todo.length) return map;
        const t0 = Date.now();
        await Promise.all(todo.map(async src => {
            try {
                map.set(src, await blobToDataUrl(await fetchImage(src)));
            } catch (e) {
                map.set(src, '');
                log('图片', imageName(src), '没嵌进文档', e);
                console.warn(`[${NAME}] 图片读取失败`, src, e);
            }
        }));
        log('图片', `这一批 ${todo.length} 张，成功 ${todo.filter(src => map.get(src)).length} 张，用了 ${Date.now() - t0}ms`);
        return map;
    }

    let markdownIt;
    function markdown(source, block) {
        markdownIt ??= typeof globalThis.markdownit === 'function'
            ? globalThis.markdownit({ html: false, linkify: false, typographer: false, breaks: true })
            : null;
        if (!markdownIt) return esc(source).replace(/\n/g, '<br>');
        const isBlock = block || /\n\s*\n|(^|\n)\s{0,3}(#{1,6}\s+|>\s+|[-*+]\s+|\d+\.\s+|```|~~~)|(^|\n)\s*\|.+\|\s*(\n|$)/.test(source);
        return isBlock ? markdownIt.render(source) : markdownIt.renderInline(source).replace(/\n/g, '<br>');
    }

    function splitDollarMath(value) {
        const text = String(value || '');
        const parts = [];
        let cursor = 0;
        let i = 0;
        const escaped = at => { let n = 0; for (let j = at - 1; j >= 0 && text[j] === '\\'; j--) n++; return n % 2 === 1; };
        const find = (delim, from) => { for (let at = text.indexOf(delim, from); at >= 0; at = text.indexOf(delim, at + delim.length)) if (!escaped(at)) return at; return -1; };
        while ((i = text.indexOf('$', i)) >= 0) {
            if (escaped(i)) { i++; continue; }
            const delim = text[i + 1] === '$' ? '$$' : '$';
            const close = find(delim, i + delim.length);
            if (close < 0) break;
            const tex = text.slice(i + delim.length, close).trim();
            if (tex) {
                if (i > cursor) parts.push({ type: 'text', value: text.slice(cursor, i) });
                parts.push({ type: 'math', value: tex, display: delim === '$$' });
                cursor = close + delim.length;
            }
            i = close + delim.length;
        }
        if (cursor < text.length) parts.push({ type: 'text', value: text.slice(cursor) });
        return parts;
    }

    function mathHtml(tex, display, ctx) {
        return ctx.renderMath
            ? `<span class="tex" data-d="${display ? 1 : 0}">${esc(tex)}</span>`
            : `<span class="tex-src">${esc(display ? `$$${tex}$$` : `$${tex}$`)}</span>`;
    }

    function inlineHtml(segments, ctx, block) {
        const tokens = [];
        let source = '';
        const math = (tex, display) => { tokens.push(mathHtml(tex, display, ctx)); return `XYMATH${tokens.length - 1}XY`; };
        segments.forEach(s => {
            if (s.type === 'math') source += math(s.value, s.display);
            else splitDollarMath(s.value).forEach(part => { source += part.type === 'math' ? math(part.value, part.display) : part.value; });
        });
        return markdown(source, block).replace(/XYMATH(\d+)XY/g, (_, i) => tokens[i]);
    }

    function richHtml(segments, ctx, block = false) {
        const html = [];
        let group = [];
        const flush = () => {
            if (group.length) html.push(`<div class="rt">${inlineHtml(group, ctx, block)}</div>`);
            group = [];
        };
        segments.forEach(s => {
            if (s.type === 'break') flush();
            else if (s.type === 'image') {
                flush();
                const data = ctx.images.get(s.src);
                html.push(data ? `<img class="pic" src="${esc(data)}" alt="题目图片">` : '<div class="pic-failed">[图片读取失败]</div>');
            } else group.push(s);
        });
        flush();
        return html.join('');
    }

    const answerHtml = (q, answer, ctx) => q.type === 10 ? `<pre class="code">${esc(answer)}</pre>` : richHtml([{ type: 'text', value: answer }], ctx, true);

    function questionHtml(q, ctx, answer) {
        const options = list => list.map(o => `<div class="opt"><b>${o.letter}.</b><div>${richHtml(o.content.segments, ctx)}</div></div>`).join('');
        const body = q.options.length ? options(q.options)
            : q.type === 4 ? `<p class="note">（本题共 ${q.items.length} 个填空）</p>`
            : q.type === 7 ? '<p class="note">附件题，无需作答。</p>'
            : q.type === 13 ? `<p class="sub">左侧</p>${options(q.left)}<p class="sub">右侧候选</p>${options(q.right)}`
            : '';
        const ans = answer ? `<div class="ans"><b>答案</b>${answerHtml(q, answer, ctx)}</div>` : '';
        return `<section class="q"><h3>${q.index}. ${esc(q.label)}</h3><div class="stem">${richHtml(q.title.segments, ctx)}</div>${body}${ans}</section>`;
    }

    const PRINT_CSS = `
        @page { size: A4 portrait; margin: 16mm 15mm; }
        * { box-sizing: border-box; }
        body { margin: 0; color: #16181d; font: 14px/1.75 "Microsoft YaHei", "PingFang SC", Arial, sans-serif; }
        header { margin-bottom: 18px; padding-bottom: 12px; border-bottom: 2px solid #16181d; }
        h1 { margin: 0; font-size: 22px; line-height: 1.35; }
        h2 { margin: 0 0 8px; font-size: 16px; }
        h3 { margin: 0 0 6px; font-size: 14px; }
        .meta { margin: 4px 0 0; color: #5d6371; font-size: 12px; }
        .rules { margin-top: 12px; padding: 9px 11px; border: 1px solid #e3e5ea; background: #f8f9fb; color: #444a56; font-size: 11.5px; line-height: 1.7; }
        .tip { margin: 0 0 12px; padding: 8px 11px; background: #eef3ff; color: #2c4fb8; font-size: 12px; font-weight: 600; }
        .group { margin: 16px 0; padding: 12px 14px; border: 1px solid #dfe3ea; border-radius: 6px; background: #f8f9fb; }
        .q { margin: 0 0 14px; padding-bottom: 14px; border-bottom: 1px solid #e6e8ec; break-inside: avoid-page; }
        .stem { font-weight: 600; }
        .rt { overflow-wrap: anywhere; }
        .rt p { margin: 0 0 6px; }
        .rt p:last-child { margin-bottom: 0; }
        .rt ul, .rt ol { margin: 6px 0 8px 22px; padding: 0; }
        .rt blockquote { margin: 8px 0; padding: 6px 10px; border-left: 3px solid #a3abb9; background: #f8f9fb; color: #4b5260; }
        .rt code { padding: 1px 3px; border-radius: 3px; background: #f1f2f4; font: 12px Consolas, monospace; }
        .rt pre { margin: 8px 0; padding: 9px 10px; border: 1px solid #e3e5ea; background: #f8f9fb; white-space: pre-wrap; }
        .rt table { width: 100%; margin: 8px 0; border-collapse: collapse; font-size: 12px; }
        .rt th, .rt td { padding: 5px 7px; border: 1px solid #d3d7de; vertical-align: top; }
        .opt { display: grid; grid-template-columns: 24px minmax(0, 1fr); gap: 4px; margin-top: 4px; padding-left: 12px; break-inside: avoid-page; }
        .sub { margin: 10px 0 2px 12px; font-weight: 700; }
        .note { margin: 6px 0 0 12px; color: #5d6371; }
        .pic { display: block; max-width: 100%; max-height: 88mm; margin: 6px 0; object-fit: contain; break-inside: avoid-page; }
        .pic-failed { margin: 6px 0; padding: 12px; border: 1px dashed #c9cdd5; color: #6b7280; }
        .ans { margin-top: 8px; padding: 7px 10px; border-left: 3px solid #16181d; background: #f8f9fb; overflow-wrap: anywhere; }
        .ans > b { display: block; font-size: 12px; }
        .code { margin: 4px 0 0; padding: 8px 10px; border: 1px solid #e3e5ea; background: #fff; font: 12px/1.6 Consolas, "Courier New", monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
        .appendix { break-before: page; }
        .appendix .row { display: grid; grid-template-columns: 32px minmax(0, 1fr); margin-top: 6px; }
        .toc h2 { margin: 14px 0 4px; font-size: 14px; }
        .toc ol { margin: 0; padding-left: 24px; }
        .toc a { color: #2c4fb8; text-decoration: none; }
        .paper-title { break-before: page; page-break-before: always; }
        .paper .appendix { break-before: auto; margin-top: 18px; }
        .tex-src { font-family: Consolas, "Courier New", monospace; overflow-wrap: anywhere; }
        .tex:not(.ok) { font-family: Consolas, "Courier New", monospace; }
        .tex:not(.ok)::before, .tex:not(.ok)::after { content: "$"; }
        .tex[data-d="1"] { display: block; margin: 6px 0; text-align: center; overflow-x: auto; }
        @media print { .tip { display: none; } }
    `;

    const pageHtml = (title, body, tip) => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${PRINT_CSS}</style></head><body>${tip ? `<p class="tip">${PRINT_TIP}</p>` : ''}${body}</body></html>`;

    function paperBody(p, ctx, head, answers) {
        const inline = prefs.answerAt === 'inline';
        const body = p.sections.map(section =>
            (section.title?.segments.length ? `<div class="group">${richHtml(section.title.segments, ctx, true)}</div>` : '')
            + section.questions.map(q => questionHtml(q, ctx, inline ? answers.get(q.index) : '')).join('')).join('');
        const appendix = !inline && answers.size
            ? `<section class="appendix"><h2>答案</h2>${p.questions.filter(q => answers.has(q.index)).map(q => `<div class="row"><b>${q.index}.</b>${answerHtml(q, answers.get(q.index), ctx)}</div>`).join('')}</section>`
            : '';
        return `${head}<main>${body}</main>${appendix}`;
    }

    function documentHtml(p, kind, ctx) {
        const course = getCourse(p.groupId);
        let head;
        if (kind === 'ai') {
            head = `<header><h1>${esc(p.title)}</h1><p class="meta">${course ? `课程：${esc(course)} · ` : ''}共 ${p.questions.length} 题</p>
                <div class="rules">请根据以下题目作答，严格按指定格式返回答案，不要输出解析、注释或额外说明。<br>
                单选/判断：1 =&gt; A　　多选：2 =&gt; A,C　　填空：3 =&gt; const | let<br>
                简答：4 =&gt; 完整文字答案　　匹配：5 =&gt; A:a,d | B:b,c　　附件题无需回答</div></header>`;
        } else {
            const title = { both: p.title, course: course && `课程：${course}`, paper: p.title, none: '' }[prefs.header];
            const meta = prefs.header === 'both' && course ? `<p class="meta">课程：${esc(course)}</p>` : '';
            head = title ? `<header><h1>${esc(title)}</h1>${meta}</header>` : '';
        }
        return pageHtml(p.title, paperBody(p, ctx, head, kind === 'homework' && prefs.withAnswers ? exportAnswers(p) : new Map()), ctx.tip);
    }

    async function typesetIn(win) {
        const nodes = [...win.document.querySelectorAll('.tex')];
        const source = nodes.length ? GM_getResourceText('mathjax') : '';
        log('公式', `${nodes.length} 个`, nodes.length ? `MathJax 资源 ${source ? `${source.length} 字符` : '没读到，保留 TeX'}` : '');
        if (!source) return;
        const t0 = Date.now();
        const run = code => {
            const script = win.document.createElement('script');
            script.textContent = code;
            win.document.head.appendChild(script);
        };
        run("window.MathJax = { startup: { typeset: false }, svg: { fontCache: 'none' }, options: { enableMenu: false } };");
        run(source);
        const mathJax = win.MathJax;
        await mathJax.startup.promise;
        nodes.forEach(node => {
            try {
                node.replaceChildren(mathJax.tex2svg(node.textContent, { display: node.dataset.d === '1' }));
                node.classList.add('ok');
            } catch (e) {
                log('公式', '有一个渲染失败', e);
                console.warn(`[${NAME}] 公式渲染失败`, node.textContent, e);
            }
        });
        win.document.head.appendChild(mathJax.svgStylesheet());
        log('公式', `渲染好 ${nodes.filter(node => node.classList.contains('ok')).length} / ${nodes.length} 个，用了 ${Date.now() - t0}ms`);
    }

    function openPrintWindow() {
        const win = window.open('', '_blank');
        log('打印', win ? '打印窗口已打开' : '打印窗口被浏览器拦截了');
        if (!win) throw new Error('浏览器拦截了新窗口，请允许本站弹出窗口后再试');
        win.document.write(`<!doctype html><meta charset="utf-8"><title>正在生成</title><body style="margin:0;padding:32px;font:15px/1.7 'Microsoft YaHei',sans-serif;color:#444">正在整理题目和图片…</body>`);
        win.document.close();
        return win;
    }

    const DIALOG_MS = 100;

    async function printHtml(win, html, renderMath) {
        const t0 = Date.now();
        log('打印', `准备写入 ${html.length} 字符，打印窗口${win.closed ? '已经被关掉' : '还开着'}，本页 ${document.visibilityState}`);
        win.document.open();
        win.document.write(html);
        win.document.close();
        const doc = win.document;
        log('打印', `窗口里：标题「${doc.title}」 作业 ${doc.querySelectorAll('.paper').length} 份 题目 ${doc.querySelectorAll('.q').length} 道 图片 ${doc.images.length} 张 公式 ${doc.querySelectorAll('.tex').length} 个 文字 ${doc.body ? doc.body.textContent.length : '没有 body'} 字 readyState=${doc.readyState}，用了 ${Date.now() - t0}ms`);
        let gone = false;
        const closing = new Promise(resolve => win.addEventListener('pagehide', () => {
            gone = true;
            log('打印', '打印窗口被关掉了（pagehide）');
            resolve();
        }));
        let settled = false;
        win.addEventListener('beforeprint', () => log('打印', '打印对话框出现了（beforeprint）'));
        win.addEventListener('afterprint', () => {
            settled = true;
            log('打印', '打印对话框关掉了（afterprint）');
        });
        if (renderMath) {
            await Promise.race([closing, typesetIn(win).catch(e => {
                log('公式', 'MathJax 加载失败，保留 TeX', e);
                console.warn(`[${NAME}] MathJax 加载失败，公式保留 TeX`, e);
            })]);
        }
        const t1 = Date.now();
        await Promise.race([closing, Promise.all([...doc.images].map(img => img.decode().catch(() => {})))]);
        if (gone || win.closed) {
            log('打印', '打印窗口已经被关掉，这一份不打印了');
            return -1;
        }
        log('打印', `图片解码完，${[...doc.images].filter(img => !img.naturalWidth).length} 张是坏的，用了 ${Date.now() - t1}ms。调用 print()`);
        saveLog();
        const t2 = Date.now();
        win.focus();
        win.print();
        const ms = Date.now() - t2;
        const closed = gone || win.closed || (ms >= DIALOG_MS && !settled);
        log('打印', `print() 返回了，卡了 ${ms}ms${ms < DIALOG_MS ? '：这么短，打印对话框没有弹出来' : ''}，${closed ? `打印窗口被关掉了${settled ? '' : '（对话框开着的时候关的，没有 afterprint）'}` : '打印窗口还开着'}`);
        return closed ? -1 : ms;
    }

    async function printDocument(kind) {
        const p = paper;
        log('导出', `单份 ${kind === 'ai' ? '图文 PDF' : '作业 PDF'}`, paperLine(p), `附答案=${prefs.withAnswers} 答案位置=${prefs.answerAt} 标题=${prefs.header}`);
        const win = openPrintWindow();
        try {
            const ctx = { images: await inlineImages(p.images), renderMath: kind === 'homework', tip: true };
            await printHtml(win, documentHtml(p, kind, ctx), ctx.renderMath);
        } catch (e) {
            log('导出', '单份 PDF 失败', e);
            win.document.body.textContent = `导出失败：${e.message}`;
            throw e;
        }
    }

    const docBlob = html => new Blob(['﻿', html], { type: 'application/msword' });

    function saveFile(blob, name) {
        log('下载', name, `${Math.round(blob.size / 1024)}KB`);
        const url = URL.createObjectURL(blob);
        const link = Object.assign(document.createElement('a'), { href: url, download: name });
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
    }

    async function downloadDoc() {
        const p = paper;
        log('导出', '单份 DOC', paperLine(p), `附答案=${prefs.withAnswers} 答案位置=${prefs.answerAt} 标题=${prefs.header}`);
        saveFile(docBlob(documentHtml(p, 'homework', { images: await inlineImages(p.images), renderMath: false })), `${fileSafe(p.title)}_${stamp()}.doc`);
    }

    async function copyImage(src) {
        const blob = await fetchImage(src);
        let png = blob;
        if (blob.type !== 'image/png') {
            const bitmap = await createImageBitmap(blob);
            const canvas = Object.assign(document.createElement('canvas'), { width: bitmap.width, height: bitmap.height });
            canvas.getContext('2d').drawImage(bitmap, 0, 0);
            png = await new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('图片转换失败')), 'image/png'));
        }
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    }

    async function loadCourses() {
        const list = (await api(COURSES_API)).data;
        const courseList = (Array.isArray(list) ? list : []).filter(g => g?.id && g.name)
            .map(g => ({ id: String(g.id), name: String(g.name).trim(), term: String(g.term_name || '') }));
        log('总复习', `课程 ${courseList.length} 门（接口返回 ${Array.isArray(list) ? `${list.length} 条` : '不是列表'}）`, courseList.map(c => `${c.name}=${c.id}`).join('、'));
        return courseList;
    }

    const taskLine = t => `「${t.name}」${t.chapter || '未分组'} ${t.kind} ${t.when} 开始=${when(t.start)} 截止=${when(t.end)} node=${t.nodeId} paper=${t.paperId}`;

    async function loadTasks(groupId) {
        const list = (await api(RESOURCES_API + encodeURIComponent(groupId))).data;
        const all = Array.isArray(list) ? list : [];
        const byId = new Map(all.map(x => [String(x.id), x]));
        const ids = x => String(x.path || x.id).split('/');
        const now = Date.now();
        const papers = all.filter(x => Number(x.type) === 7);
        const tasks = papers.filter(x => x.is_task && x.quote_id)
            .map(x => ({ x, order: ids(x).map(id => Number(byId.get(id)?.sort_position) || 0) }))
            .sort((a, b) => {
                for (let i = 0; i < Math.min(a.order.length, b.order.length); i++) if (a.order[i] !== b.order[i]) return a.order[i] - b.order[i];
                return a.order.length - b.order.length;
            })
            .map(({ x }) => {
                const start = Date.parse(x.start_time);
                const end = Date.parse(x.end_time);
                return {
                    nodeId: String(x.id),
                    paperId: String(x.quote_id),
                    name: String(x.name || '未命名'),
                    chapter: ids(x).length > 2 ? String(byId.get(ids(x)[1])?.name || '') : '',
                    kind: TASK_KIND[x.task_type] || '作业',
                    start,
                    end,
                    when: start > now ? 'soon' : end > now ? 'open' : 'ended',
                };
            });
        const count = state => tasks.filter(t => t.when === state).length;
        log('总复习', `课程 ${groupId}：资源 ${all.length} 条，type 7 的 ${papers.length} 条，其中能用的任务 ${tasks.length} 个（已截止 ${count('ended')}，进行中 ${count('open')}，没开始 ${count('soon')}）`,
            papers.length > tasks.length ? `没用上的：${papers.filter(x => !(x.is_task && x.quote_id)).map(x => `「${x.name}」is_task=${x.is_task} quote_id=${x.quote_id ? '有' : '无'}`).join('、')}` : '');
        tasks.forEach(t => log('任务', taskLine(t)));
        return tasks;
    }

    async function readPaper(groupId, task) {
        const data = (await api(`${PAPER_API}?paper_id=${task.paperId}&group_id=${groupId}&node_id=${task.nodeId}`)).data;
        if (!Array.isArray(data?.questions)) throw new Error('没有题目');
        return buildPaper(data, { groupId, nodeId: task.nodeId, paperId: task.paperId });
    }

    function taskHtml(task, ctx, course, anchor) {
        const r = task.paper.result;
        const meta = [course, task.chapter, r ? `得分 ${r.score ?? '-'} / ${r.total ?? '-'}` : '没有交卷'].filter(Boolean).map(esc).join('　');
        const answers = prefs.withAnswers ? exportAnswers(task.paper) : new Map();
        const html = paperBody(task.paper, ctx, `<header><h1${anchor ? ` class="paper-title"><a name="${anchor}"></a>` : '>'}${esc(task.paper.title)}</h1><p class="meta">${meta}</p></header>`, answers);
        log('文档', `「${task.paper.title}」${task.chapter || '未分组'}：${task.paper.questions.length} 题，附答案 ${answers.size} 题，${html.length} 字符`);
        return html;
    }

    function bookHtml(course, tasks, ctx) {
        const toc = tasks.map((task, i) => {
            const head = i && tasks[i - 1].chapter === task.chapter ? '' : `${i ? '</ol>' : ''}<h2>${esc(task.chapter || '未分组')}</h2><ol>`;
            return `${head}<li><a href="#p${i}">${esc(task.paper.title)}</a></li>`;
        }).join('');
        const papers = tasks.map((task, i) => `<article class="paper">${taskHtml(task, ctx, '', `p${i}`)}</article>`).join('');
        return pageHtml(`${course} 总复习`, `<header><h1>${esc(course)} 总复习</h1><p class="meta">共 ${tasks.length} 份</p></header><nav class="toc">${toc}</ol></nav>${papers}`, ctx.tip);
    }

    function zip(files) {
        const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
        const crc32 = bytes => { let c = 0xffffffff; for (const b of bytes) c = table[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
        const u16 = n => new Uint8Array([n & 255, n >>> 8 & 255]);
        const u32 = n => new Uint8Array([n & 255, n >>> 8 & 255, n >>> 16 & 255, n >>> 24 & 255]);
        const encoder = new TextEncoder();
        const local = [];
        const central = [];
        let offset = 0;
        files.forEach(file => {
            const name = encoder.encode(file.name);
            const data = encoder.encode(file.text);
            const common = [u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc32(data)), u32(data.length), u32(data.length), u16(name.length), u16(0)];
            local.push(u32(0x04034b50), ...common, name, data);
            central.push(u32(0x02014b50), u16(20), ...common, u16(0), u16(0), u16(0), u32(0), u32(offset), name);
            offset += 30 + name.length + data.length;
        });
        const size = central.reduce((n, part) => n + part.length, 0);
        return new Blob([...local, ...central, u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(size), u32(offset), u16(0)], { type: 'application/zip' });
    }

    async function exportTasks(course, tasks, images, win, halted) {
        const ctx = { images, renderMath: !!win, tip: !!win };
        const name = `${fileSafe(course)}_总复习_${stamp()}`;
        log('导出', `总复习「${course}」${tasks.length} 份：打包=${prefs.pack} 格式=${win ? 'pdf' : 'doc'} 附答案=${prefs.withAnswers} 答案位置=${prefs.answerAt}，图片 ${images.size} 张（读到 ${[...images.values()].filter(Boolean).length} 张）`);
        if (prefs.pack === 'one') {
            const html = bookHtml(course, tasks, ctx);
            log('导出', `合成的文档 ${html.length} 字符`);
            if (win) return { done: await printHtml(win, html, true) < 0 ? 0 : tasks.length };
            saveFile(docBlob(html), `${name}.doc`);
            return { done: tasks.length };
        }
        const title = task => `${task.chapter} ${task.paper.title}`.trim();
        const page = task => pageHtml(title(task), taskHtml(task, ctx, course), ctx.tip);
        if (!win) {
            saveFile(zip(tasks.map((task, i) => ({ name: `${pad2(i + 1)}_${fileSafe(title(task))}.doc`, text: `﻿${page(task)}` }))), `${name}.zip`);
            return { done: tasks.length };
        }
        let done = 0;
        let noDialog = false;
        for (const task of tasks) {
            if (halted()) break;
            log('导出', `单独打印第 ${done + 1} / ${tasks.length} 份「${title(task)}」`);
            const ms = await printHtml(win, page(task), true);
            if (ms < DIALOG_MS) {
                noDialog = ms >= 0;
                break;
            }
            done++;
        }
        log('导出', `每份单独：打印了 ${done} / ${tasks.length} 份${noDialog ? '，停下是因为浏览器没有弹出保存窗口' : ''}`);
        return { done, noDialog };
    }

    async function loadNotice() {
        try {
            const res = await gmRequest({
                method: 'POST',
                url: NOTICE_API,
                timeout: 10000,
                headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
                data: JSON.stringify({ action: 'get_notice', channel: NOTICE_CHANNEL, client: `xiaoya-zhanzhanzhan-v${VERSION}` }),
            });
            const data = JSON.parse(res.responseText);
            if (data.ok !== true || data.channel !== NOTICE_CHANNEL) throw new Error('公告格式不对');
            notice = { content: String(data.content || '暂无公告'), version: String(data.version || ''), updatedAt: String(data.updatedAt || '') };
            log('公告', `最新版本 v${notice.version || '-'}，更新于 ${notice.updatedAt || '-'}`);
        } catch (e) {
            log('公告', '读取失败', e);
            console.warn(`[${NAME}] 公告读取失败`, e);
            notice = { error: true, content: '公告加载失败' };
        }
        view.notice();
    }

    const noticeKey = () => notice && !notice.error ? `${notice.version}|${notice.updatedAt}|${notice.content}` : '';
    const noticeUnread = () => !!noticeKey() && notice.content !== '暂无公告' && prefs.seen !== noticeKey();
    const hasUpdate = () => !!notice && !notice.error && isNewer(notice.version, VERSION);

    const ICON = {
        copy: '<svg class="i" viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
        out: '<svg class="i" viewBox="0 0 24 24"><path d="M12 15V4"/><path d="m7.5 8.5 4.5-4.5 4.5 4.5"/><path d="M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/></svg>',
        img: '<svg class="i" viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m20.5 16-4.5-4.5-8.5 8"/></svg>',
        score: '<svg class="i" viewBox="0 0 24 24"><path d="M5 20V11"/><path d="M12 20V5"/><path d="M19 20v-6"/></svg>',
        min: '<svg class="i" viewBox="0 0 24 24"><path d="M6 12h12"/></svg>',
        x: '<svg class="i" viewBox="0 0 24 24"><path d="M7 7l10 10M17 7 7 17"/></svg>',
        go: '<svg class="i" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>',
        theme: '<svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/></svg>',
    };

    const SVG = {
        tape: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#e8edfc"/><polygon points="25,35 58,35 54.5,39.5 58,44 25,44" fill="#2f54d4"/><circle cx="25" cy="27" r="17" fill="#2f54d4"/><circle cx="25" cy="27" r="12.5" fill="none" stroke="#6d8bec" stroke-width="1.5"/><circle cx="25" cy="27" r="8.5" fill="#e8edfc"/></svg>',
        zhu: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#18202e"/><path d="M13.5 33.5c4.6-.4 8.8 3.4 13 10.4 5.6-12.4 13.6-23.2 24-31.4-8.6 10.2-15.8 22.8-20.4 36.2-1.1 2.6-4.1 2.8-5.5.4-3.2-6.2-6.6-11.4-11.1-15.6z" fill="#e2583e"/></svg>',
        ring: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 104 74" preserveAspectRatio="none"><path d="M30 13C58 3 96 12 98 34c2 22-36 34-62 32C14 64 2 52 7 36 11 24 24 15 46 11" fill="none" stroke="#e2583e" stroke-width="2.4" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>',
        check: color => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M3.5 12.6c2-.2 3.8 1.4 5.6 4.4 2.4-5.4 5.9-10.1 10.4-13.6-3.7 4.4-6.8 9.9-8.8 15.7-.5 1.1-1.8 1.2-2.4.2-1.4-2.7-2.8-4.9-4.8-6.7z" fill="${color}"/></svg>`,
        cross: color => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${color}"><path d="M5.2 5.5c4.6 3.3 9 7.7 13.6 13.4-.5.6-1.2.8-1.8.5C12.6 14.6 8.6 10.5 4.4 6.6c-.2-.7.2-1.2.8-1.1z"/><path d="M18.6 4.6c.6.1 1 .6.8 1.2-4.2 4.1-8.2 8.7-12.4 13.6-.7.3-1.3.1-1.6-.5 3.9-5.4 8.2-10.2 13.2-14.3z"/></svg>`,
        dashed: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="7.5" fill="none" stroke="#8e9aad" stroke-width="1.4" stroke-dasharray="2.6 2.6"/></svg>',
        tick: color => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="m4 8.3 2.7 2.7L12 5.4" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
        dash: color => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M4.5 8h7" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round"/></svg>`,
    };
    const svgUrl = svg => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
    const THEMES = { tape: '胶带', zhu: '朱批' };

    const STATE_LABEL = { ok: '正确', part: '部分得分', bad: '错误', none: '未作答', pending: '待批改' };
    const MARGIN = 8;

    const CSS = `

        .zz { all: initial; --head-h: 55px; --z-sans: "Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", sans-serif; --z-num: "Segoe UI", sans-serif; position: fixed; z-index: 2147483000; font: 13px/1.5 var(--z-sans); color: var(--ink); -webkit-font-smoothing: antialiased; text-align: left; }
        .zz *, .zz *::before, .zz *::after { box-sizing: border-box; }
        .zz button { margin: 0; font: inherit; color: inherit; cursor: pointer; }
        .zz button:disabled { cursor: default; opacity: .45; }
        .zz :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
        .zz p { margin: 0; }
        [hidden] { display: none !important; }
        .trigger { display: none; position: relative; align-items: center; border: 0; touch-action: none; user-select: none; }
        .zz[data-open="0"] .trigger { display: flex; }
        .zz[data-open="0"] .shell { display: none; }
        .shell { position: relative; }
        .zz.enter .shell { animation: zz-in .2s cubic-bezier(.2, .8, .2, 1); }
        .zz.leave .shell { animation: zz-out .14s ease forwards; }
        @keyframes zz-in { from { opacity: 0; transform: translateY(-6px) scale(.985); } }
        @keyframes zz-out { to { opacity: 0; } }
        .t-dot { position: absolute; top: 5px; right: 5px; width: 7px; height: 7px; border-radius: 50%; background: var(--alert); }
        .t-mark, .mark { display: block; flex: none; background: center / contain no-repeat var(--logo); }
        .ring, .mk, .cn { display: none; }

        /* 首次引导：选风格 → 用法。引导时只显示引导内容 */
        .guide { display: none; flex: 1 1 auto; min-height: 0; padding: 4px 16px 18px; overflow: auto; }
        .zz[data-guide="1"] .guide { display: block; }
        .zz[data-guide="1"] .modes, .zz[data-guide="1"] .body, .zz[data-guide="1"] .batch, .zz[data-guide="1"] .foot, .zz[data-guide="1"] .result, .zz[data-guide="1"] [data-res-btn] { display: none !important; }
        .g-page { display: none; }
        .guide[data-step="1"] .g-page[data-step="1"], .guide[data-step="2"] .g-page[data-step="2"] { display: grid; gap: 14px; }
        .g-kicker { font-size: 11.5px; color: var(--muted); }
        .g-title { margin: -8px 0 0; font-size: 18px; line-height: 1.35; font-weight: 700; }
        .themes { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .theme-card { display: grid; gap: 4px; padding: 0 0 10px; text-align: left; overflow: hidden; border: 1.5px solid var(--line); background: transparent; }
        .theme-card[aria-pressed="true"] { border-color: var(--accent); }
        .theme-card b { padding: 0 10px; font-size: 13.5px; }
        .theme-card small { padding: 0 10px; font-size: 11px; line-height: 1.5; color: var(--muted); }
        .tc-art { display: block; position: relative; height: 72px; margin-bottom: 6px; }
        .tc-art.tape-art { background: linear-gradient(135deg, #eef2fb, #dce4f6); }
        .tc-art.tape-art::before { content: ""; position: absolute; left: 16px; right: 16px; top: 20px; bottom: -8px; border-radius: 9px; background: rgba(255, 255, 255, .9); box-shadow: 0 6px 16px -8px rgba(24, 34, 64, .4); }
        .tc-art.tape-art::after { content: ""; position: absolute; left: calc(50% - 26px); top: 12px; width: 52px; height: 15px; transform: rotate(-4deg); background: rgba(98, 131, 236, .7); clip-path: polygon(0 0, 100% 0, 95% 25%, 100% 50%, 95% 75%, 100% 100%, 0 100%, 5% 75%, 0 50%, 5% 25%); }
        .tc-art.zhu-art { background: ${svgUrl(SVG.check('#e2583e'))} 58% 52% / 34px no-repeat, #18202e; }
        .tc-art.zhu-art::after { content: ""; position: absolute; left: 22px; right: 22px; bottom: 14px; height: 1px; background: rgba(241, 237, 228, .25); }
        .g-hint { font-size: 11.5px; color: var(--muted); }
        .g-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
        .g-list li { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; align-items: start; }
        .g-t { font-size: 13px; font-weight: 600; }
        .g-list li > span { grid-column: 2; font-size: 12px; color: var(--ink-2); }
        .g-tips { margin: 0; padding: 12px 0 0 16px; border-top: 1px solid var(--line); display: grid; gap: 4px; font-size: 11.5px; color: var(--muted); }
        .g-acts { display: grid; grid-template-columns: 1fr 2fr; gap: 8px; }

        .main { position: relative; width: 372px; max-height: calc(100vh - ${MARGIN * 2}px); display: flex; flex-direction: column; }
        .head { display: flex; align-items: center; gap: 9px; padding: 14px 14px 12px 16px; cursor: move; user-select: none; touch-action: none; }
        .mark { width: 22px; height: 22px; }
        .brand { font-weight: 700; font-size: 14px; }
        /* 版本号是诊断日志的入口：单击复制，双击下载。外观不提示能点 */
        .head .ver { border: 0; background: none; padding: 0; font: 500 11px var(--z-num); color: var(--muted); cursor: default; }
        .sp { flex: 1; }
        .ib { width: 28px; height: 28px; display: grid; place-items: center; padding: 0; border: 0; background: transparent; border-radius: 8px; color: var(--muted); }
        .ib:hover { background: var(--hover); color: var(--ink); }
        svg.i { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
        .body { flex: 1 1 auto; min-height: 0; overflow: auto; scrollbar-width: thin; }
        .task { padding: 4px 16px 12px; }
        .course { font-size: 12px; color: var(--muted); min-height: 18px; }
        .paper { font-size: 18px; font-weight: 700; line-height: 1.35; overflow-wrap: anywhere; }
        .meta { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
        .meta span { font-size: 11px; color: var(--muted); }
        .empty { padding: 4px 16px 16px; color: var(--muted); font-size: 12.5px; }
        .zz[data-paper="0"] .task, .zz[data-paper="0"] .steps, .zz[data-paper="0"] .foot { display: none; }
        .zz[data-paper="1"] .empty { display: none; }
        .notice { margin: 0 16px 12px; display: flex; align-items: baseline; gap: 8px; font-size: 12px; }
        .n-tag { flex: none; position: relative; font-weight: 700; }
        .n-tag.unread::after { content: ""; position: absolute; top: 0; right: -6px; width: 5px; height: 5px; border-radius: 50%; background: var(--alert); }
        .n-badge { flex: none; font: 600 10.5px var(--z-num); padding: 0 6px; border-radius: 999px; color: var(--alert); background: var(--alert-soft); }
        .n-txt { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--ink-2); }
        .notice[data-open="1"] .n-txt { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 180px; overflow: auto; }
        .n-txt a { color: inherit; text-decoration: underline; text-decoration-color: var(--line-strong); text-underline-offset: 2px; }
        .n-more { flex: none; border: 0; background: none; padding: 0; color: var(--accent); font-size: 12px; }
        .steps { list-style: none; margin: 0; padding: 6px 16px 16px; display: grid; gap: 16px; }
        .step-h { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; font-size: 12px; }
        .btn { width: 100%; height: 40px; display: flex; align-items: center; justify-content: center; gap: 8px; border: 1px solid transparent; font-weight: 600; font-size: 13px; transition: background .15s ease, color .15s ease, border-color .15s ease, transform .1s ease; }
        .btn:active:not(:disabled) { transform: translateY(1px); }
        .btn.sm { height: 32px; font-size: 12px; font-weight: 500; }
        .hint, .s-msg { font-size: 11.5px; color: var(--muted); margin-top: 7px; }
        .s-msg[data-kind="ok"] { color: var(--good); }
        .s-msg[data-kind="warn"] { color: var(--warn); }
        .s-msg[data-kind="error"] { color: var(--bad); }
        textarea { display: block; width: 100%; height: 128px; margin: 0; resize: vertical; padding: 8px 10px; font: 12px/22px "Cascadia Mono", Consolas, ui-monospace, monospace; color: var(--ink); outline: none; }
        .parse { display: flex; justify-content: space-between; gap: 8px; margin-top: 8px; font-size: 11.5px; color: var(--muted); }
        .p-txt { flex: none; white-space: nowrap; }
        .p-miss { color: var(--warn); text-align: right; }
        .bubbles { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
        .bubbles i { font-style: normal; }
        .issues { margin: 8px 0 0; padding: 0; list-style: none; display: grid; gap: 2px; font-size: 11.5px; color: var(--bad); }
        .bar { height: 3px; margin-top: 8px; border-radius: 2px; background: var(--track); overflow: hidden; visibility: hidden; }
        .bar.on { visibility: visible; }
        .bar i { display: block; height: 100%; width: 0; background: var(--accent); transition: width .1s linear; }
        .foot { flex: none; display: flex; gap: 4px; padding: 8px 10px; }
        .fb { display: inline-flex; align-items: center; gap: 6px; border: 0; background: none; padding: 6px 8px; border-radius: 8px; font-size: 12.5px; color: var(--ink-2); }
        .fb:hover:not(:disabled) { background: var(--hover); }
        .fb em { font-style: normal; font-family: var(--z-num); color: var(--muted); }
        .toast { position: absolute; left: 12px; right: 12px; bottom: 54px; z-index: 4; padding: 8px 12px; font-size: 12px; color: var(--toast-ink); background: var(--toast); border-radius: var(--toast-r); opacity: 0; transform: translateY(4px); transition: opacity .16s ease, transform .16s ease; pointer-events: none; }
        .toast.on { opacity: 1; transform: none; }
        .toast[data-kind="error"] { background: var(--bad); color: #fff; }

        .sheet-clip { position: absolute; left: 0; right: 0; bottom: 0; top: var(--head-h); overflow: hidden; border-radius: inherit; border-top-left-radius: 0; border-top-right-radius: 0; pointer-events: none; }
        .sheet { position: absolute; inset: 0; display: flex; flex-direction: column; background: var(--sheet); transform: translateY(102%); visibility: hidden; transition: transform .22s cubic-bezier(.2, .8, .2, 1), visibility 0s .22s; pointer-events: auto; }
        .main[data-sheet="export"] .sheet, .main[data-sheet="img"] .sheet { transform: none; visibility: visible; transition: transform .22s cubic-bezier(.2, .8, .2, 1), visibility 0s; }
        .sh-head { display: flex; align-items: center; padding: 12px 14px 8px 16px; font-weight: 700; font-size: 13.5px; }
        [data-v] { display: none; }
        .main[data-sheet="export"] [data-v="export"], .main[data-sheet="img"] [data-v="img"] { display: block; }
        .sh-body { flex: 1; min-height: 0; padding: 4px 16px 16px; overflow: auto; scrollbar-width: thin; }
        .grp + .grp { margin-top: 16px; }
        .g-h { font-size: 11.5px; color: var(--muted); margin-bottom: 8px; }
        .row-btn { width: 100%; display: flex; align-items: center; gap: 10px; text-align: left; padding: 10px 12px; border: 1px solid var(--line); background: transparent; }
        .row-btn > span { flex: 1; }
        .row-btn b { display: block; font-size: 13px; }
        .row-btn small { display: block; font-size: 11.5px; color: var(--muted); }
        .row-btn svg { flex: none; color: var(--muted); }
        .fld { display: grid; grid-template-columns: 76px 1fr; align-items: center; gap: 10px; margin-bottom: 10px; font-size: 12px; }
        .fld > span { color: var(--ink-2); }
        .fld input { width: 100%; height: 30px; margin: 0; padding: 0 9px; font: 12.5px var(--z-sans); color: var(--ink); outline: none; }
        .seg { display: flex; flex-wrap: wrap; gap: 2px; padding: 2px; }
        .seg button { flex: 1 1 auto; border: 0; background: none; padding: 3px 6px; font-size: 11.5px; color: var(--muted); white-space: nowrap; }
        .seg button[aria-pressed="true"] { color: var(--ink); }
        .fld[data-off="1"] { opacity: .45; pointer-events: none; }
        .sw { width: 34px; height: 20px; border: 0; padding: 0; position: relative; justify-self: start; }
        .sw::after { content: ""; position: absolute; top: 3px; left: 3px; width: 14px; height: 14px; border-radius: 50%; transition: transform .15s ease; }
        .sw[aria-checked="true"]::after { transform: translateX(14px); }
        .g-note { font-size: 11px; color: var(--muted); margin: 2px 0 12px !important; }
        .acts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
        .imgs { display: grid; gap: 14px; }
        .img-item { display: grid; gap: 6px; }
        .img-item .cap { font-size: 11.5px; color: var(--muted); }
        .img-item img { display: block; max-width: 100%; max-height: 220px; object-fit: contain; border: 1px solid var(--line); background: #fff; }
        .img-item .acts { grid-template-columns: 1fr 1fr; }

        /* 成绩面板挂在主面板左边，高度跟主面板一样，题目多时在内部滚动；窄屏时叠在主面板上 */
        .result { position: absolute; top: 0; bottom: 0; right: calc(100% + 12px); width: 296px; display: flex; flex-direction: column; }
        .zz[data-result="0"] .result { display: none; }
        .result.r-enter { animation: zz-in .18s cubic-bezier(.2, .8, .2, 1); }
        .zz.narrow .result { z-index: 5; right: 0; }
        .r-head { display: flex; align-items: center; padding: 14px 10px 4px 16px; }
        .r-title { font-weight: 700; font-size: 13.5px; }
        .score { position: relative; display: flex; align-items: baseline; gap: 6px; padding: 4px 16px 6px; }
        .score b { font-family: var(--z-num); }
        .of { font-size: 12px; color: var(--muted); }
        .counts { display: flex; flex-wrap: wrap; gap: 4px 12px; padding: 0 16px; font-size: 12px; color: var(--ink-2); }
        .counts .c-bad { color: var(--bad); }
        .r-note { padding: 6px 16px 10px; font-size: 11px; color: var(--muted); }
        .tabs { display: flex; gap: 4px; padding: 0 12px 8px; }
        .tab { border: 0; background: none; padding: 4px 9px; font-size: 12px; color: var(--muted); }
        .tab em { font-style: normal; font-family: var(--z-num); }
        .tab[aria-pressed="true"] { color: var(--ink); }
        .list { flex: 1; min-height: 0; overflow: auto; padding: 0 8px 10px; scrollbar-width: thin; }
        .list[data-filter="bad"] .row:not([data-s="bad"]):not([data-s="part"]):not([data-s="none"]),
        .list[data-filter="pending"] .row:not([data-s="pending"]) { display: none; }
        .list[data-filter="bad"] .sec-h, .list[data-filter="pending"] .sec-h { display: none; }
        .sec-h { padding: 10px 8px 2px; font-size: 11px; color: var(--muted); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        .row { padding: 10px 8px; display: grid; gap: 3px; }
        .row-top { display: flex; align-items: center; gap: 8px; }
        .qn { font: 600 12px var(--z-num); color: var(--ink); min-width: 18px; }
        .qt { font-size: 11px; color: var(--muted); }
        .pts { margin-left: auto; font: 500 11.5px var(--z-num); color: var(--muted); }
        .chip { font-size: 10.5px; font-weight: 600; padding: 0 7px; line-height: 18px; }
        .t { font-size: 12px; color: var(--ink-2); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        .mine { font-size: 11.5px; color: var(--muted); white-space: pre-wrap; overflow-wrap: anywhere; }
        .mine b { font-weight: 600; color: var(--ink-2); }
        .filter-empty { display: none; padding: 16px 8px; font-size: 12px; color: var(--muted); }

        /* 标签页：这份作业 / 总复习。总复习不显示当前这份作业的内容和成绩 */
        .modes { display: flex; flex: none; }
        .modes .mode { border: 0; background: none; padding: 0; font-size: 12.5px; color: var(--muted); white-space: nowrap; }
        .modes .mode[aria-pressed="true"] { color: var(--ink); }
        .zz[data-mode="all"] .body, .zz[data-mode="all"] .foot, .zz[data-mode="all"] .result, .zz[data-mode="all"] [data-res-btn] { display: none; }

        /* 总复习。data-state：list 清单，pick 选课，hint 只有一句话（读取中、没有任务、读取失败） */
        .batch { display: none; flex: 1 1 auto; min-height: 0; flex-direction: column; overflow-y: auto; scrollbar-width: thin; }
        .zz[data-mode="all"] .batch { display: flex; }
        .batch:not([data-state="list"]) .b-top, .batch:not([data-state="list"]) .b-list, .batch:not([data-state="list"]) .b-dock { display: none; }
        .b-pick, .b-hint { display: none; padding: 4px 16px 18px; }
        .batch[data-state="pick"] .b-pick, .batch[data-state="hint"] .b-hint { display: block; }
        .b-hint { font-size: 12.5px; color: var(--muted); }
        .b-hint-a { display: flex; gap: 8px; margin-top: 12px; }
        .b-hint-a .btn { width: auto; padding: 0 14px; }
        .batch .b-pick-h { margin-bottom: 6px; font-size: 18px; font-weight: 700; line-height: 1.35; }
        .pk { width: 100%; display: flex; align-items: baseline; gap: 10px; padding: 11px 0; border: 0; border-bottom: 1px solid var(--line); background: none; text-align: left; font-size: 13px; }
        .pk small { flex: none; margin-left: auto; font-size: 11px; color: var(--muted); }
        .pk:hover { color: var(--accent); }
        .b-top { flex: none; padding: 4px 16px 8px; }
        .b-course { display: flex; align-items: baseline; gap: 10px; }
        .b-name { flex: 1; min-width: 0; font-size: 18px; font-weight: 700; line-height: 1.35; overflow-wrap: anywhere; }
        .batch .b-swap { flex: none; border: 0; background: none; padding: 0; font-size: 12px; color: var(--accent); }
        .b-sum { display: flex; align-items: center; gap: 8px; margin-top: 8px; font-size: 12px; color: var(--ink-2); cursor: pointer; }
        .b-count { margin-left: auto; color: var(--muted); }
        .b-count b { font-family: var(--z-num); font-weight: 600; color: var(--ink); }
        .ck { -webkit-appearance: none; appearance: none; flex: none; width: 16px; height: 16px; margin: 0; cursor: pointer; background: center / contain no-repeat; }
        .ck:disabled { opacity: .4; cursor: default; }
        .b-list { flex: 1 1 auto; min-height: 96px; overflow: auto; scrollbar-width: thin; padding: 0 8px 6px; }
        .ch-h { position: sticky; top: 0; z-index: 1; display: flex; align-items: center; gap: 8px; padding: 9px 8px 5px; font-size: 12px; font-weight: 600; background: var(--sheet); cursor: pointer; }
        .ch-n { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
        .ch-h em { flex: none; font: 500 11px var(--z-num); color: var(--muted); }
        .it { display: flex; align-items: center; gap: 8px; padding: 6px 8px; font-size: 12.5px; cursor: pointer; }
        .it-n { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
        .it[data-on="0"] .it-n { color: var(--muted); }
        .it-s { flex: none; max-width: 168px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 11px; color: var(--muted); }
        .it-open { margin-right: 5px; font-weight: 600; color: var(--warn); }
        .it-sc { margin: 0 2px 0 7px; font-family: var(--z-num); font-weight: 600; color: var(--ink); }
        .it[data-s="run"] .it-s { color: var(--accent); }
        .it[data-s="fail"] .it-s { color: var(--bad); }
        .b-dock { flex: none; display: grid; gap: 10px; padding: 10px 16px 14px; }
        /* 一条是一份作业，章与章之间留空：没选、选了、读好了、没读到 */
        .strip { display: flex; flex-wrap: wrap; gap: 3px 2px; }
        .strip i { flex: none; transition: background .15s ease, border-color .15s ease; }
        .strip i.first { margin-left: 5px; }
        .strip i.run { animation: zz-pulse .5s ease-in-out infinite alternate; }
        .b-opt { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .b-ans { display: flex; align-items: center; gap: 10px; font-size: 12px; color: var(--ink-2); }
        .b-ans .seg { margin-left: auto; }
        .b-ans .seg[data-off="1"] { opacity: .45; pointer-events: none; }
        .b-msg { min-height: 33px; font-size: 11.5px; line-height: 16.5px; color: var(--muted); }
        .b-msg[data-kind="ok"] { color: var(--good); }
        .b-msg[data-kind="warn"] { color: var(--warn); }
        .b-msg[data-kind="error"] { color: var(--bad); }
        .b-msg button { border: 0; background: none; padding: 0; font-size: 11.5px; color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }
        .batch[data-run="1"] .b-swap, .batch[data-run="1"] .b-sum, .batch[data-run="1"] .b-list .ck, .batch[data-run="1"] .b-opt, .batch[data-run="1"] .b-ans { pointer-events: none; opacity: .5; }
        @keyframes zz-pulse { to { opacity: .3; } }
        @media (prefers-reduced-motion: reduce) { .zz.enter .shell, .zz.leave .shell, .result.r-enter { animation-duration: 1ms; } .sheet, .toast { transition: none; } .strip i { animation: none !important; } }
    `;

    const TAPE = `
        .zz[data-theme="tape"] {
            --ink: #151922; --ink-2: #3a4150; --muted: #6b7384; --blue: #2b4fd0; --soft: #f0f3fb;
            --line: rgba(21, 25, 34, .08); --line-strong: rgba(21, 25, 34, .22);
            --accent: #2b4fd0; --alert: #d9443a; --alert-soft: #fdebe9; --warn: #a2620c; --bad: #c6362c; --good: #1b7a48;
            --hover: rgba(21, 25, 34, .045); --track: #e1e5ee; --sheet: #fff; --head-h: 62px;
            --toast: #151922; --toast-ink: #fff; --toast-r: 10px;
            --z-num: "Bahnschrift", "DIN Alternate", "Segoe UI", sans-serif;
            --stripe: repeating-linear-gradient(90deg, rgba(255, 255, 255, .2) 0 2px, transparent 2px 6px);
            --logo: ${svgUrl(SVG.tape)};
            font-variant-numeric: tabular-nums;
        }
        [data-theme="tape"] .main, [data-theme="tape"] .result { background: rgba(255, 255, 255, .94); backdrop-filter: blur(22px) saturate(1.3); -webkit-backdrop-filter: blur(22px) saturate(1.3); border-radius: 16px; box-shadow: 0 0 0 1px var(--line), 0 1px 2px rgba(18, 26, 56, .06), 0 32px 64px -30px rgba(18, 26, 56, .42); }
        [data-theme="tape"] .modes { position: absolute; z-index: 3; top: -13px; left: 16px; gap: 8px; }
        [data-theme="tape"] .mode, [data-theme="tape"] .r-title { height: 26px; padding: 0 16px; font-size: 12px; font-weight: 600; clip-path: polygon(0 0, 100% 0, calc(100% - 3px) 25%, 100% 50%, calc(100% - 3px) 75%, 100% 100%, 0 100%, 3px 75%, 0 50%, 3px 25%); }
        [data-theme="tape"] .mode { color: #3f57ad; background: var(--stripe), rgba(160, 178, 238, .42); transition: transform .15s ease; }
        [data-theme="tape"] .mode:nth-child(1) { transform: rotate(-2deg); }
        [data-theme="tape"] .mode:nth-child(2) { transform: rotate(1.5deg); }
        [data-theme="tape"] .mode:hover { transform: none; }
        [data-theme="tape"] .mode:focus-visible { outline: none; text-decoration: underline; text-underline-offset: 3px; }
        [data-theme="tape"] .mode[aria-pressed="true"], [data-theme="tape"] .r-title { color: #fff; background: var(--stripe), var(--blue); }
        [data-theme="tape"] .r-title { position: absolute; z-index: 3; top: -13px; left: 16px; display: flex; align-items: center; transform: rotate(-1.5deg); }
        [data-theme="tape"] .head { padding: 24px 12px 10px 18px; }
        [data-theme="tape"] .brand { font-size: 13.5px; }
        [data-theme="tape"] .ver { font-size: 11.5px; }
        [data-theme="tape"] .ib { border-radius: 7px; }
        [data-theme="tape"] .guide { padding: 4px 18px 18px; }
        [data-theme="tape"] .theme-card { border-radius: 12px; }
        [data-theme="tape"] .task { padding: 6px 18px 12px; }
        [data-theme="tape"] .paper, [data-theme="tape"] .g-title, [data-theme="tape"] .b-name, [data-theme="tape"] .b-pick-h { font-size: 20px; letter-spacing: -.01em; }
        [data-theme="tape"] .meta { gap: 2px 12px; margin-top: 6px; }
        [data-theme="tape"] .meta span { font-size: 12px; }
        [data-theme="tape"] .empty { padding: 6px 18px 16px; }
        [data-theme="tape"] .notice { margin: 0 18px 14px; padding: 9px 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
        [data-theme="tape"] .n-tag { color: var(--blue); }
        [data-theme="tape"] .steps { gap: 18px; padding: 2px 18px 16px; }
        [data-theme="tape"] .step-h { gap: 7px; font-size: 12.5px; font-weight: 600; }
        [data-theme="tape"] .no { font: 600 14px/1 var(--z-num); color: var(--blue); }
        [data-theme="tape"] .btn { border-radius: 10px; }
        [data-theme="tape"] .btn.pri { background: var(--blue); color: #fff; }
        [data-theme="tape"] .btn.pri:hover:not(:disabled) { background: #2444b8; }
        [data-theme="tape"] .btn.sec { background: transparent; border-color: var(--line-strong); color: var(--ink); }
        [data-theme="tape"] .btn.sec:hover:not(:disabled) { border-color: var(--ink); }
        [data-theme="tape"] .btn.sm { border-color: transparent; background: var(--soft); }
        [data-theme="tape"] .btn.sm:hover:not(:disabled) { border-color: transparent; background: #e4e9f6; }
        [data-theme="tape"] textarea { background: #fff; border: 1px solid var(--line-strong); border-radius: 10px; }
        [data-theme="tape"] textarea:focus { border-color: var(--blue); box-shadow: 0 0 0 3px rgba(43, 79, 208, .14); }
        /* 小条：粘贴框下面一条是一道题，总复习底部一条是一份作业 */
        [data-theme="tape"] .bubbles { gap: 3px 2px; }
        [data-theme="tape"] .bubbles i, [data-theme="tape"] .strip i { width: 5px; height: 14px; border-radius: 1.5px; background: var(--track); font-size: 0; }
        [data-theme="tape"] .strip i.on { background: #b3c2f3; }
        [data-theme="tape"] .bubbles i.on, [data-theme="tape"] .strip i.run, [data-theme="tape"] .strip i.ok { background: var(--blue); }
        [data-theme="tape"] .bubbles i.err, [data-theme="tape"] .strip i.fail { background: var(--bad); }
        [data-theme="tape"] .foot { padding: 8px 12px; border-top: 1px solid var(--line); }
        [data-theme="tape"] .fb { border-radius: 7px; }
        [data-theme="tape"] .seg { background: var(--soft); border-radius: 9px; }
        [data-theme="tape"] .seg button { padding: 4px 6px; border-radius: 7px; }
        [data-theme="tape"] .seg button[aria-pressed="true"] { background: #fff; box-shadow: 0 0 0 1px var(--line), 0 1px 2px rgba(18, 26, 56, .1); }
        [data-theme="tape"] .sw { border-radius: 10px; background: #cfd5e1; }
        [data-theme="tape"] .sw::after { background: #fff; box-shadow: 0 1px 2px rgba(0, 0, 0, .2); }
        [data-theme="tape"] .sw[aria-checked="true"] { background: var(--blue); }
        [data-theme="tape"] .sheet { border-top: 1px solid var(--line); box-shadow: 0 -16px 32px -24px rgba(18, 26, 56, .4); }
        [data-theme="tape"] .sh-head { padding: 12px 12px 8px 18px; }
        [data-theme="tape"] .sh-body { padding: 4px 18px 16px; }
        [data-theme="tape"] .row-btn { border-radius: 10px; }
        [data-theme="tape"] .row-btn:hover { background: var(--hover); }
        [data-theme="tape"] .fld input { border: 1px solid var(--line-strong); border-radius: 8px; background: #fff; }
        [data-theme="tape"] .fld input:focus { border-color: var(--blue); }
        [data-theme="tape"] .img-item img { border-radius: 8px; }
        [data-theme="tape"] .b-top { padding: 6px 18px 10px; }
        [data-theme="tape"] .b-pick, [data-theme="tape"] .b-hint { padding: 6px 18px 18px; }
        [data-theme="tape"] .ck { border-radius: 5px; box-shadow: inset 0 0 0 1.5px #bcc3d1; }
        [data-theme="tape"] .ck:checked, [data-theme="tape"] .ck:indeterminate { background-color: var(--blue); box-shadow: none; }
        [data-theme="tape"] .ck:checked { background-image: ${svgUrl(SVG.tick('#fff'))}; }
        [data-theme="tape"] .ck:indeterminate { background-image: ${svgUrl(SVG.dash('#fff'))}; }
        [data-theme="tape"] .b-list { padding: 0 10px 6px; border-top: 1px solid var(--line); }
        [data-theme="tape"] .it { border-radius: 8px; }
        [data-theme="tape"] .it:hover { background: var(--hover); }
        [data-theme="tape"] .b-dock { padding: 12px 18px 16px; border-top: 1px solid var(--line); }
        /* 成绩面板：每题左边一条小条表示对错 */
        [data-theme="tape"] .r-head { padding: 20px 10px 0 16px; }
        [data-theme="tape"] .r-score { font-size: 48px; line-height: 1; font-weight: 600; }
        [data-theme="tape"] .tabs { gap: 14px; padding: 0 16px; border-bottom: 1px solid var(--line); }
        [data-theme="tape"] .tab { margin-bottom: -1px; padding: 4px 0 7px; border-bottom: 2px solid transparent; }
        [data-theme="tape"] .tab[aria-pressed="true"] { font-weight: 600; border-bottom-color: var(--ink); }
        [data-theme="tape"] .list { padding-top: 4px; }
        [data-theme="tape"] .sec-h { padding-left: 18px; }
        [data-theme="tape"] .row { position: relative; padding-left: 18px; border-radius: 8px; }
        [data-theme="tape"] .row::before { content: ""; position: absolute; left: 7px; top: 13px; width: 3px; height: 14px; border-radius: 1.5px; background: var(--track); }
        [data-theme="tape"] .row:hover { background: var(--hover); }
        [data-theme="tape"] .row[data-s="ok"]::before { background: var(--good); }
        [data-theme="tape"] .row[data-s="bad"]::before { background: var(--bad); }
        [data-theme="tape"] .row[data-s="part"]::before { background: var(--warn); }
        [data-theme="tape"] .row[data-s="pending"]::before { background: #9aa9d6; }
        [data-theme="tape"] .chip { padding: 0; color: var(--muted); }
        [data-theme="tape"] .row[data-s="ok"] .chip { color: var(--good); }
        [data-theme="tape"] .row[data-s="bad"] .chip { color: var(--bad); }
        [data-theme="tape"] .row[data-s="part"] .chip { color: var(--warn); }
        [data-theme="tape"] .row[data-s="pending"] .chip { color: #4a5fa8; }
        /* 收起后是一卷胶带，中间是题数 */
        [data-theme="tape"] .trigger { width: 58px; height: 58px; padding: 0; justify-content: center; border-radius: 50%; background: radial-gradient(circle, #fff 0 17px, rgba(255, 255, 255, .5) 17.5px 18.5px, transparent 19px), repeating-radial-gradient(circle, #5d7fec 0 2px, #6a8bf0 2px 4px); box-shadow: 0 14px 28px -12px rgba(47, 84, 212, .6), inset 0 0 0 1px rgba(255, 255, 255, .25); transition: transform .15s ease; }
        [data-theme="tape"] .trigger:hover { transform: rotate(-8deg); }
        [data-theme="tape"][data-dragging] .trigger { transform: none; }
        [data-theme="tape"] .t-mark, [data-theme="tape"] .t-name, [data-theme="tape"] .t-num small { display: none; }
        [data-theme="tape"] .t-num { font: 700 15px/1 var(--z-num); color: var(--ink); }
        [data-theme="tape"] .t-dot { top: 2px; right: 2px; box-shadow: 0 0 0 2px #fff; }
    `;

    const ZHU = `
        .zz[data-theme="zhu"] {
            color-scheme: dark;
            --ink: #e8ecf2; --ink-2: #c3cad6; --muted: #8e9aad; --surf: #1d2737; --deep: #141b27; --zhu: #e2583e; --paper: #f1ede4;
            --line: rgba(232, 236, 242, .1); --line-strong: rgba(232, 236, 242, .3);
            --accent: #f1ede4; --alert: #e2583e; --alert-soft: rgba(226, 88, 62, .16); --warn: #e9a46a; --bad: #ef7a62; --good: #9fd3b0;
            --hover: rgba(232, 236, 242, .06); --track: rgba(232, 236, 242, .1); --sheet: #1d2737; --head-h: 89px;
            --toast: #f1ede4; --toast-ink: #18202e; --toast-r: 6px;
            --z-num: "Segoe UI", "SF Pro Text", sans-serif;
            --z-kai: "KaiTi", "STKaiti", "Kaiti SC", "楷体", serif;
            --logo: ${svgUrl(SVG.zhu)};
        }
        [data-theme="zhu"] .main, [data-theme="zhu"] .result { background: var(--surf); border: 1px solid var(--line); border-radius: 10px; box-shadow: 0 32px 60px -26px rgba(8, 12, 20, .7), 0 2px 8px rgba(8, 12, 20, .25); }
        [data-theme="zhu"] .head { border-bottom: 1px solid var(--line); }
        /* 标签页在标题栏下面，分隔线跟着移到标签页下面（引导时没有标签页，线留在标题栏下） */
        [data-theme="zhu"][data-guide="0"] .head { border-bottom: 0; }
        [data-theme="zhu"] .modes { gap: 18px; padding: 0 16px; border-bottom: 1px solid var(--line); }
        [data-theme="zhu"] .mode { margin-bottom: -1px; padding: 2px 0 8px; font: 400 15.5px var(--z-kai); border-bottom: 1.5px solid transparent; }
        [data-theme="zhu"] .mode[aria-pressed="true"] { color: var(--paper); border-bottom-color: var(--paper); }
        /* 总复习：勾选是手写的勾，读完后分数用红笔写在右边 */
        [data-theme="zhu"] .b-top, [data-theme="zhu"] .b-pick, [data-theme="zhu"] .b-hint { padding-top: 12px; }
        [data-theme="zhu"] .b-name, [data-theme="zhu"] .b-pick-h { font: 400 24px/1.3 var(--z-kai); }
        [data-theme="zhu"] .b-swap { color: var(--ink-2); text-decoration: underline; text-underline-offset: 3px; text-decoration-color: var(--line-strong); }
        [data-theme="zhu"] .ck { width: 18px; height: 18px; background-image: linear-gradient(var(--surf), var(--surf)), linear-gradient(rgba(232, 236, 242, .34), rgba(232, 236, 242, .34)); background-size: 11px 11px, 13px 13px; }
        [data-theme="zhu"] .ck:checked { background-image: ${svgUrl(SVG.check('#f1ede4'))}; background-size: 18px; }
        [data-theme="zhu"] .ck:indeterminate { background-image: ${svgUrl(SVG.dash('#f1ede4'))}; background-size: 16px; }
        [data-theme="zhu"] .b-list { border-top: 1px solid var(--line); }
        [data-theme="zhu"] .ch-h { padding-top: 11px; font: 400 14.5px var(--z-kai); color: var(--paper); }
        [data-theme="zhu"] .it:hover { background: var(--hover); }
        [data-theme="zhu"] .it-sc { font: 400 16px/1 var(--z-kai); color: var(--zhu); }
        [data-theme="zhu"] .b-dock { border-top: 1px solid var(--line); }
        [data-theme="zhu"] .strip { gap: 3px; }
        [data-theme="zhu"] .strip i { width: 8px; height: 8px; border: 1px solid rgba(232, 236, 242, .22); }
        [data-theme="zhu"] .strip i.first { margin-left: 6px; }
        [data-theme="zhu"] .strip i.on { border-color: var(--paper); }
        [data-theme="zhu"] .strip i.run, [data-theme="zhu"] .strip i.ok { background: var(--paper); border-color: var(--paper); }
        [data-theme="zhu"] .strip i.fail { background: var(--zhu); border-color: var(--zhu); }
        [data-theme="zhu"] .pk:hover { color: var(--paper); }
        [data-theme="zhu"] .brand { font: 400 18px var(--z-kai); letter-spacing: .06em; }
        [data-theme="zhu"] .ib:hover { color: var(--paper); }
        [data-theme="zhu"] .task { padding-top: 12px; }
        [data-theme="zhu"] .paper, [data-theme="zhu"] .g-title { font: 400 24px/1.3 var(--z-kai); margin-top: 2px; }
        [data-theme="zhu"] .g-title { margin-top: -8px; }
        [data-theme="zhu"] .meta span + span::before { content: "·"; margin-right: 6px; color: var(--line-strong); }
        [data-theme="zhu"] .notice { padding: 8px 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
        [data-theme="zhu"] .n-tag { font: 400 14px var(--z-kai); color: var(--paper); }
        [data-theme="zhu"] .n-more { color: var(--ink-2); text-decoration: underline; text-underline-offset: 3px; text-decoration-color: var(--line-strong); }
        [data-theme="zhu"] .no { display: none; }
        [data-theme="zhu"] .cn { display: inline; font-weight: 400; }
        [data-theme="zhu"] .step-h { font: 400 15.5px var(--z-kai); color: var(--paper); gap: 0; }
        [data-theme="zhu"] .g-t, [data-theme="zhu"] .g-list .cn { font: 400 15.5px var(--z-kai); color: var(--paper); }
        [data-theme="zhu"] .btn { border-radius: 6px; }
        [data-theme="zhu"] .btn.pri { background: var(--paper); color: #18202e; }
        [data-theme="zhu"] .btn.pri:hover:not(:disabled) { background: #fff; }
        [data-theme="zhu"] .btn.sec { background: transparent; border-color: rgba(232, 236, 242, .26); color: var(--ink); }
        [data-theme="zhu"] .btn.sec:hover:not(:disabled) { border-color: rgba(232, 236, 242, .5); background: var(--hover); }
        [data-theme="zhu"] textarea { background: var(--deep); border: 1px solid var(--line); border-radius: 6px; color: var(--ink); }
        [data-theme="zhu"] textarea:focus { border-color: rgba(241, 237, 228, .4); }
        [data-theme="zhu"] textarea::placeholder { color: #5f6b7e; }
        [data-theme="zhu"] .bubbles { gap: 3px; }
        [data-theme="zhu"] .bubbles i { width: 10px; height: 10px; border: 1px solid rgba(232, 236, 242, .22); font-size: 0; transition: background .15s ease; }
        [data-theme="zhu"] .bubbles i.on { background: var(--paper); border-color: var(--paper); }
        [data-theme="zhu"] .bubbles i.err { background: var(--zhu); border-color: var(--zhu); }
        [data-theme="zhu"] .foot { border-top: 1px solid var(--line); }
        [data-theme="zhu"] .row-btn { border: 1px solid var(--line); border-radius: 6px; }
        [data-theme="zhu"] .row-btn:hover { background: var(--hover); }
        [data-theme="zhu"] .fld input { border: 1px solid var(--line); border-radius: 5px; background: var(--deep); }
        [data-theme="zhu"] .seg { border: 1px solid var(--line); border-radius: 6px; }
        [data-theme="zhu"] .seg button { border-radius: 4px; }
        [data-theme="zhu"] .seg button[aria-pressed="true"] { background: rgba(241, 237, 228, .12); color: var(--paper); }
        [data-theme="zhu"] .sw { border-radius: 10px; background: rgba(232, 236, 242, .16); }
        [data-theme="zhu"] .sw::after { background: var(--muted); }
        [data-theme="zhu"] .sw[aria-checked="true"] { background: var(--paper); }
        [data-theme="zhu"] .sw[aria-checked="true"]::after { background: #18202e; }
        [data-theme="zhu"] .sh-head { font: 400 16px var(--z-kai); border-bottom: 1px solid var(--line); }
        [data-theme="zhu"] .img-item img { border-radius: 4px; }
        [data-theme="zhu"] .r-title { font: 400 16px var(--z-kai); }
        [data-theme="zhu"] .score { padding: 12px 16px 10px 26px; }
        [data-theme="zhu"] .sc { position: relative; display: inline-block; }
        [data-theme="zhu"] .ring { display: block; position: absolute; inset: -12px -20px -10px -18px; background: ${svgUrl(SVG.ring)} center / 100% 100% no-repeat; pointer-events: none; }
        [data-theme="zhu"] .r-score { position: relative; font: 400 56px/1 var(--z-kai); color: var(--zhu); }
        [data-theme="zhu"] .of { font: 15px var(--z-kai); margin-left: 18px; }
        [data-theme="zhu"] .tabs { border-bottom: 1px solid var(--line); padding: 0 12px; gap: 14px; }
        [data-theme="zhu"] .tab { padding: 6px 0; border-bottom: 1.5px solid transparent; margin-bottom: -1px; }
        [data-theme="zhu"] .tab[aria-pressed="true"] { color: var(--paper); border-bottom-color: var(--paper); }
        [data-theme="zhu"] .list { padding-top: 4px; }
        [data-theme="zhu"] .row { grid-template-columns: 26px 1fr; column-gap: 6px; border-bottom: 1px solid var(--line); }
        [data-theme="zhu"] .row > * { grid-column: 2; }
        [data-theme="zhu"] .row > .mk { display: block; grid-column: 1; grid-row: 1 / span 4; width: 22px; height: 22px; background: center / contain no-repeat; }
        [data-theme="zhu"] .row[data-s="ok"] .mk { background-image: ${svgUrl(SVG.check('#e2583e'))}; }
        [data-theme="zhu"] .row[data-s="part"] .mk { background-image: ${svgUrl(SVG.check('#e9a46a'))}; }
        [data-theme="zhu"] .row[data-s="bad"] .mk { background-image: ${svgUrl(SVG.cross('#e2583e'))}; }
        [data-theme="zhu"] .row[data-s="none"] .mk { background-image: ${svgUrl(SVG.cross('#8e9aad'))}; }
        [data-theme="zhu"] .row[data-s="pending"] .mk { background-image: ${svgUrl(SVG.dashed)}; }
        [data-theme="zhu"] .chip { display: none; }
        [data-theme="zhu"] .sec-h { padding: 12px 8px 2px; font: 400 13px var(--z-kai); }
        [data-theme="zhu"] .theme-card { border-radius: 8px; }
        [data-theme="zhu"] .trigger { gap: 10px; height: 46px; padding: 0 16px 0 8px; background: var(--surf); border: 1px solid var(--line); border-radius: 23px; color: var(--ink); box-shadow: 0 16px 32px -14px rgba(8, 12, 20, .7); }
        [data-theme="zhu"] .t-mark { width: 30px; height: 30px; }
        [data-theme="zhu"] .t-name { font: 400 16px var(--z-kai); letter-spacing: .04em; }
        [data-theme="zhu"] .t-num { font: 500 12px var(--z-num); color: var(--muted); }
        [data-theme="zhu"] .t-num small { margin-left: 1px; }
    `;

    function template() {
        return `
<div class="zz" data-open="0" data-paper="0" data-result="0" data-guide="0" data-mode="all">
  <button class="trigger" type="button" data-act="open">
    <span class="t-mark"></span><span class="t-name">粘粘粘</span><span class="t-num"></span><i class="t-dot" hidden></i>
  </button>
  <div class="shell">
    <aside class="result" aria-label="提交结果">
      <div class="r-head"><span class="r-title">提交结果</span><span class="sp"></span><button class="ib" type="button" data-act="result" title="收起成绩">${ICON.go}</button></div>
      <div class="score"><span class="sc"><i class="ring"></i><b class="r-score"></b></span><span class="of"></span></div>
      <div class="counts"></div>
      <div class="r-note"></div>
      <div class="tabs">
        <button class="tab" type="button" data-act="filter" data-f="all" aria-pressed="true">全部 <em></em></button>
        <button class="tab" type="button" data-act="filter" data-f="bad" aria-pressed="false">错题 <em></em></button>
        <button class="tab" type="button" data-act="filter" data-f="pending" aria-pressed="false">待批改 <em></em></button>
      </div>
      <div class="list" data-filter="all"></div>
    </aside>
    <section class="main" data-sheet="">
      <header class="head">
        <span class="mark"></span><span class="brand">小雅粘粘粘</span><button class="ver" type="button" data-act="log" title="单击复制诊断日志，双击下载完整日志">v${VERSION}</button><span class="sp"></span>
        <button class="ib" type="button" data-act="result" data-res-btn title="提交结果" hidden>${ICON.score}</button>
        <button class="ib theme-btn" type="button" data-act="theme">${ICON.theme}</button>
        <button class="ib" type="button" data-act="close" title="收起">${ICON.min}</button>
      </header>
      <nav class="modes" aria-label="视图">
        <button class="mode" type="button" data-act="mode" data-m="paper">这份作业</button>
        <button class="mode" type="button" data-act="mode" data-m="all">总复习</button>
      </nav>
      <div class="guide" data-step="1">
        <div class="g-page" data-step="1">
          <p class="g-kicker">初次使用 · 1 / 2</p>
          <p class="g-title">选一个喜欢的样子</p>
          <div class="themes">
            <button class="theme-card" type="button" data-act="pick-theme" data-theme="tape"><span class="tc-art tape-art"></span><b>胶带</b><small>白底细线，标签页是两截胶带</small></button>
            <button class="theme-card" type="button" data-act="pick-theme" data-theme="zhu"><span class="tc-art zhu-art"></span><b>朱批</b><small>蓝黑墨水底色，红笔只用来批改</small></button>
          </div>
          <p class="g-hint">以后随时可以点右上角的半圆按钮切换。</p>
          <button class="btn pri" type="button" data-act="guide-next"><span>下一步</span></button>
        </div>
        <div class="g-page" data-step="2">
          <p class="g-kicker">2 / 2</p>
          <p class="g-title">三步完成作答</p>
          <ol class="g-list">
            <li><b class="no">1</b><b class="cn">一、</b><b class="g-t">复制题目</b><span>打开作业或测验页面，点「复制题目给 AI」，把内容发给任意 AI。</span></li>
            <li><b class="no">2</b><b class="cn">二、</b><b class="g-t">粘贴答案</b><span>把 AI 的回答整段粘贴到框里，面板会标出识别到哪些题、缺哪些题。</span></li>
            <li><b class="no">3</b><b class="cn">三、</b><b class="g-t">保存作答</b><span>点「保存作答记录」逐题保存，不会替你交卷；全部成功后自动刷新页面。</span></li>
          </ol>
          <ul class="g-tips">
            <li>交卷以后，左边会显示每题的得分和对错。</li>
            <li>「导出」里有给 AI 看的图文 PDF，也有不含提示词的纯净作业。</li>
            <li>「总复习」可以把一门课的作业、测验勾选后一次导出。</li>
            <li>按住标题栏或收起后的图标，可以拖到别的位置。</li>
          </ul>
          <div class="g-acts"><button class="btn sec" type="button" data-act="guide-back"><span>上一步</span></button><button class="btn pri" type="button" data-act="guide-done"><span>开始使用</span></button></div>
        </div>
      </div>
      <div class="body">
        <div class="task">
          <div class="course"></div>
          <div class="paper"></div>
          <div class="meta"></div>
        </div>
        <p class="empty">打开小雅的作业或测验页面后，这里会显示题目。</p>
        <div class="notice" data-open="0"><span class="n-tag">公告</span><span class="n-badge" hidden></span><span class="n-txt">正在加载公告…</span><button class="n-more" type="button" data-act="notice" hidden>展开</button></div>
        <ol class="steps">
          <li>
            <div class="step-h"><b class="no">1</b><b class="cn">一、</b>复制题目</div>
            <button class="btn pri" type="button" data-act="copy">${ICON.copy}<span>复制题目给 AI</span></button>
            <p class="hint">题号可能和网页上的不同，保存时按题目本身对应，不会错位。</p>
          </li>
          <li>
            <div class="step-h"><b class="no">2</b><b class="cn">二、</b>粘贴答案</div>
            <textarea spellcheck="false" aria-label="AI 返回的答案" placeholder="1 => A&#10;2 => A,C&#10;3 => const | let&#10;4 => 简答题可以写多行&#10;5 => A:a,d | B:b,c"></textarea>
            <div class="parse"><span class="p-txt"></span><span class="p-miss"></span></div>
            <div class="bubbles"></div>
            <ul class="issues"></ul>
          </li>
          <li>
            <div class="step-h"><b class="no">3</b><b class="cn">三、</b>保存作答</div>
            <button class="btn sec" type="button" data-act="save"><span>保存作答记录</span></button>
            <div class="bar"><i></i></div>
            <p class="s-msg">只保存作答，不会替你交卷。</p>
          </li>
        </ol>
      </div>
      <div class="batch" data-state="hint" data-run="0">
        <div class="b-top">
          <div class="b-course"><span class="b-name"></span><button class="b-swap" type="button" data-act="b-swap">换一门</button></div>
          <label class="b-sum"><input class="ck" type="checkbox"><span>全选</span><span class="b-count"></span></label>
        </div>
        <div class="b-list"></div>
        <div class="b-dock">
          <div class="strip" aria-hidden="true"></div>
          <div class="b-opt">
            <div class="seg" data-pref="pack"><button type="button" data-act="seg" data-val="one">合成一份</button><button type="button" data-act="seg" data-val="each">每份单独</button></div>
            <div class="seg" data-pref="fmt"><button type="button" data-act="seg" data-val="pdf">PDF</button><button type="button" data-act="seg" data-val="doc">DOC</button></div>
          </div>
          <div class="b-ans"><span>附正确答案</span><button class="sw" type="button" role="switch" data-act="switch" aria-label="附正确答案"></button><div class="seg" data-pref="answerAt" data-dep><button type="button" data-act="seg" data-val="inline">题目下方</button><button type="button" data-act="seg" data-val="end">文末</button></div></div>
          <button class="btn pri" type="button" data-act="b-go"><span>导出</span></button>
          <p class="b-msg" role="status"></p>
        </div>
        <div class="b-pick"><p class="b-pick-h">选一门课</p><div class="b-pick-l"></div></div>
        <div class="b-hint"><p></p><div class="b-hint-a"><button class="btn sec sm" type="button" data-act="b-reload" hidden><span>再读一次</span></button><button class="btn sec sm" type="button" data-act="b-swap" hidden><span>换一门</span></button></div></div>
      </div>
      <footer class="foot">
        <button class="fb" type="button" data-act="sheet" data-v-open="export">${ICON.out}导出</button>
        <button class="fb" type="button" data-act="sheet" data-v-open="img">${ICON.img}图片 <em class="img-count"></em></button>
      </footer>
      <div class="toast" role="status"></div>
      <div class="sheet-clip"><div class="sheet">
        <div class="sh-head"><span data-v="export">导出</span><span data-v="img">题目图片</span><span class="sp"></span><button class="ib" type="button" data-act="sheet-close" title="关闭">${ICON.x}</button></div>
        <div class="sh-body" data-v="export">
          <div class="grp">
            <div class="g-h">给 AI 看</div>
            <button class="row-btn" type="button" data-act="ai-pdf"><span><b>图文 PDF</b><small>带图片，公式保留 TeX，适合发给能读 PDF 的 AI</small></span>${ICON.go}</button>
          </div>
          <div class="grp">
            <div class="g-h">纯净作业（不含 AI 提示词）</div>
            <label class="fld"><span>课程名</span><input class="course-input" type="text" placeholder="可以手动填写"></label>
            <div class="fld"><span>标题</span><div class="seg" data-pref="header"><button type="button" data-act="seg" data-val="both">课程 + 作业</button><button type="button" data-act="seg" data-val="course">仅课程</button><button type="button" data-act="seg" data-val="paper">仅作业</button><button type="button" data-act="seg" data-val="none">不要</button></div></div>
            <div class="fld"><span>附正确答案</span><button class="sw" type="button" role="switch" data-act="switch" aria-label="附正确答案"></button></div>
            <div class="fld" data-dep><span>答案位置</span><div class="seg" data-pref="answerAt"><button type="button" data-act="seg" data-val="inline">题目下方</button><button type="button" data-act="seg" data-val="end">文末</button></div></div>
            <p class="g-note">只附平台公开的标准答案，或已被判为正确的作答。</p>
            <div class="acts"><button class="btn sec sm" type="button" data-act="hw-text"><span>复制文本</span></button><button class="btn sec sm" type="button" data-act="hw-pdf"><span>PDF</span></button><button class="btn sec sm" type="button" data-act="hw-doc"><span>DOC</span></button></div>
          </div>
        </div>
        <div class="sh-body" data-v="img"><div class="imgs"></div></div>
      </div></div>
    </section>
  </div>
</div>`;
    }

    const view = (() => {
        let root = null;
        let el = {};
        let failures = [];
        let saving = false;
        let imagesLoaded = false;
        let shownKey;
        let guideStep = 0;
        let toastTimer = null;
        let closeTimer = null;
        const $ = selector => root.querySelector(selector);
        const label = (button, text) => { button.querySelector('span').textContent = text; };

        function mount() {
            const host = document.createElement('div');
            host.style.cssText = 'all: initial !important';
            root = host.attachShadow({ mode: 'closed' });
            root.innerHTML = `<style>${CSS}${TAPE}${ZHU}</style>${template()}`;
            (document.body || document.documentElement).appendChild(host);
            el = {
                zz: $('.zz'), trigger: $('.trigger'), tNum: $('.t-num'), tDot: $('.t-dot'), shell: $('.shell'),
                main: $('.main'), result: $('.result'), resBtn: $('[data-res-btn]'),
                course: $('.course'), paperTitle: $('.paper'), meta: $('.meta'),
                notice: $('.notice'), nTag: $('.n-tag'), nBadge: $('.n-badge'), nTxt: $('.n-txt'), nMore: $('.n-more'),
                input: $('textarea'), pTxt: $('.p-txt'), pMiss: $('.p-miss'), bubbles: $('.bubbles'), issues: $('.issues'),
                bar: $('.bar'), barFill: $('.bar i'), sMsg: $('.s-msg'), imgCount: $('.img-count'), imgBtn: $('[data-v-open="img"]'),
                toast: $('.toast'), courseInput: $('.course-input'), imgs: $('.imgs'),
                score: $('.r-score'), of: $('.of'), counts: $('.counts'), rNote: $('.r-note'), list: $('.list'),
                themeBtn: $('.theme-btn'), guide: $('.guide'),
                batch: $('.batch'), bName: $('.b-name'), bAll: $('.b-sum .ck'), bCount: $('.b-count'), bList: $('.b-list'), strip: $('.strip'),
                bGo: $('[data-act="b-go"]'), bMsg: $('.b-msg'), bPick: $('.b-pick-l'), bHint: $('.b-hint p'), bReload: $('[data-act="b-reload"]'), bSwap: $('.b-hint [data-act="b-swap"]'),
            };
            guideStep = prefs.theme ? 0 : 1;
            log('界面', `面板挂好了：风格=${prefs.theme || '还没选'} ${prefs.welcomed ? '' : '第一次安装'}`);
            applyTheme();
            renderGuide();
            prefsToControls();
            bind();
            renderNotice();
            renderPaper();
            place(true);
            if (!prefs.welcomed) {
                prefs.welcomed = true;
                savePrefs();
                setOpen(true);
            }
        }

        function applyTheme() {
            const theme = prefs.theme || 'tape';
            const other = theme === 'tape' ? 'zhu' : 'tape';
            el.zz.dataset.theme = theme;
            el.themeBtn.title = `换成「${THEMES[other]}」风格`;
            root.querySelectorAll('.theme-card').forEach(card => card.setAttribute('aria-pressed', String(card.dataset.theme === prefs.theme)));
        }

        function setTheme(theme) {
            log('面板', `风格 → ${theme}`);
            prefs.theme = theme;
            savePrefs();
            applyTheme();
            renderTrigger();
        }

        function renderGuide() {
            el.zz.dataset.guide = guideStep ? '1' : '0';
            el.guide.dataset.step = guideStep || 1;
        }

        function prefsToControls() {
            root.querySelectorAll('.seg').forEach(seg => seg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.val === prefs[seg.dataset.pref]))));
            root.querySelectorAll('.sw').forEach(sw => sw.setAttribute('aria-checked', String(prefs.withAnswers)));
            root.querySelectorAll('[data-dep]').forEach(dep => { dep.dataset.off = prefs.withAnswers ? '0' : '1'; });
        }

        function renderTrigger() {
            el.tNum.innerHTML = paper ? `${paper.questions.length}<small>题</small>` : '—';
            el.trigger.title = paper ? `${NAME}：已读取 ${paper.questions.length} 道题，点击展开` : `${NAME}：点击展开`;
            el.tDot.hidden = !(noticeUnread() || hasUpdate() || !prefs.theme);
        }

        function renderCourse() {
            if (!root) return;
            const name = paper ? getCourse(paper.groupId) : '';
            el.course.textContent = name;
            if (root.activeElement !== el.courseInput) el.courseInput.value = name;
            el.bName.textContent = getCourse(batch.groupId) || '这门课';
        }

        function renderNotice() {
            if (!root) return;
            el.nTxt.replaceChildren();
            const content = notice ? notice.content : '正在加载公告…';
            content.split(/(https?:\/\/[^\s，。、；）)]+)/).forEach((part, i) => {
                if (i % 2) el.nTxt.append(Object.assign(document.createElement('a'), { href: part, target: '_blank', rel: 'noopener noreferrer', textContent: part }));
                else if (part) el.nTxt.append(part);
            });
            el.nMore.hidden = !notice || notice.error || !(content.includes('\n') || content.length > 24);
            el.nBadge.hidden = !hasUpdate();
            el.nBadge.textContent = hasUpdate() ? `v${notice.version} 可用` : '';
            el.nTag.classList.toggle('unread', noticeUnread());
            renderTrigger();
        }

        function renderPaper() {
            if (!root) return;
            const p = paper;
            const changed = (p?.key ?? null) !== shownKey;
            log('界面', p ? `显示题目「${p.title}」${changed ? '（换了一份）' : '（同一份，更新数据）'}` : '没有题目');
            const hadResult = !el.resBtn.hidden;
            shownKey = p?.key ?? null;
            el.zz.dataset.paper = p ? '1' : '0';
            renderTrigger();
            renderCourse();
            el.paperTitle.textContent = p?.title || '';
            el.meta.replaceChildren(...(p ? metaChips(p) : []));
            el.imgCount.textContent = p ? p.images.length : '';
            el.imgBtn.disabled = !p?.images.length;
            result(p, changed || !hadResult);
            if (changed) {
                if (!batch.running) setMode(p ? 'paper' : 'all');
                el.main.dataset.sheet = '';
                el.bubbles.replaceChildren(...(p ? p.questions.map(q => Object.assign(document.createElement('i'), { textContent: q.index, title: `第 ${q.index} 题 · ${q.label}` })) : []));
                el.input.value = '';
                failures = [];
                setMsg('只保存作答，不会替你交卷。');
                el.imgs.replaceChildren();
                imagesLoaded = false;
            }
            check();
            place(false);
        }

        function metaChips(p) {
            const counts = {};
            p.questions.forEach(q => { counts[q.label] = (counts[q.label] || 0) + 1; });
            const chip = text => Object.assign(document.createElement('span'), { textContent: text });
            return [chip(`${p.questions.length} 题`), ...Object.entries(counts).map(([type, n]) => chip(`${type.replace(/题$/, '')} ${n}`))];
        }

        function result(p, reveal) {
            const r = p?.result;
            el.resBtn.hidden = !r;
            if (!r || reveal) el.zz.dataset.result = r ? '1' : '0';
            el.list.replaceChildren();
            if (!r) return;
            const count = s => r.rows.filter(row => s.includes(row.state)).length;
            const wrong = count(['bad', 'none']);
            const part = count(['part']);
            const pending = count(['pending']);
            el.score.textContent = r.score ?? '-';
            el.of.textContent = `/ ${r.total ?? '-'} 分`;
            el.counts.innerHTML = `<span>${count(['ok'])} 正确</span><span class="c-bad">${wrong} 错误</span>${part ? `<span>${part} 部分得分</span>` : ''}<span>${pending} 待批改</span>`;
            el.rNote.textContent = p.showAnswer ? '老师已公开标准答案。' : '老师没有公开标准答案，这里只显示得分和对错。';
            const tabs = root.querySelectorAll('.tab em');
            tabs[0].textContent = r.rows.length;
            tabs[1].textContent = wrong + part;
            tabs[2].textContent = pending;
            const html = p.sections.map(section => {
                const head = section.title ? `<div class="sec-h">${esc(section.title.text || '题组')}</div>` : '';
                return head + section.questions.map(q => {
                    const row = r.rows[q.index - 1];
                    return `<div class="row" data-s="${row.state}">
                        <i class="mk"></i>
                        <div class="row-top"><span class="qn">${pad2(q.index)}</span><span class="qt">${esc(q.label)}</span><span class="chip">${STATE_LABEL[row.state]}</span><span class="pts">${row.score ?? '-'} / ${q.score ?? '-'}</span></div>
                        <div class="t">${esc(q.title.text)}</div>
                        <div class="mine"><b>我的答案</b>　${esc(row.mine || '未作答')}</div>
                        ${row.standard ? `<div class="mine"><b>标准答案</b>　${esc(row.standard)}</div>` : ''}
                    </div>`;
                }).join('');
            }).join('');
            el.list.innerHTML = html + '<p class="filter-empty">没有这类题目。</p>';
            setFilter(reveal ? 'all' : el.list.dataset.filter);
        }

        function setFilter(filter) {
            el.list.dataset.filter = filter;
            root.querySelectorAll('.tab').forEach(tab => tab.setAttribute('aria-pressed', String(tab.dataset.f === filter)));
            const visible = filter === 'all' || el.list.querySelector(filter === 'bad' ? '.row[data-s="bad"], .row[data-s="part"], .row[data-s="none"]' : '.row[data-s="pending"]');
            el.list.querySelector('.filter-empty').style.display = visible ? 'none' : 'block';
        }

        function check() {
            const p = paper;
            if (!p) return null;
            const c = checkAnswers(p, el.input.value);
            [...el.bubbles.children].forEach((b, i) => {
                b.classList.toggle('on', c.ok.has(i + 1));
                b.classList.toggle('err', c.bad.has(i + 1));
            });
            const answerable = p.questions.filter(q => q.type !== 7).length;
            el.pTxt.textContent = el.input.value.trim() ? `已识别 ${c.ok.size} / ${answerable} 题` : `共 ${answerable} 题要作答`;
            el.pMiss.textContent = !el.input.value.trim() ? '' : c.missing.length ? `缺 ${c.missing.slice(0, 6).join('、')}${c.missing.length > 6 ? ` 等 ${c.missing.length} 题` : ''}` : '全部识别';
            const problems = [...c.issues, ...failures].sort((a, b) => a.n - b.n);
            el.issues.replaceChildren(...problems.slice(0, 4).map(i => Object.assign(document.createElement('li'), { textContent: `第 ${i.n} 题：${i.message}` })));
            if (problems.length > 4) el.issues.append(Object.assign(document.createElement('li'), { textContent: `还有 ${problems.length - 4} 题有问题` }));
            return c;
        }

        function images() {
            if (imagesLoaded || !paper) return;
            imagesLoaded = true;
            el.imgs.replaceChildren(...paper.images.map((img, i) => {
                const item = document.createElement('div');
                item.className = 'img-item';
                item.innerHTML = `<span class="cap">${esc(img.label)}</span><img alt="${esc(img.label)}"><div class="acts"><button class="btn sec sm" type="button" data-act="img-copy" data-i="${i}"><span>复制图片</span></button><button class="btn sec sm" type="button" data-act="img-link" data-i="${i}"><span>复制链接</span></button></div>`;
                item.querySelector('img').src = img.src;
                return item;
            }));
        }

        function toast(message, kind = 'ok') {
            log('提示', kind, message);
            el.toast.textContent = message;
            el.toast.dataset.kind = kind;
            el.toast.classList.add('on');
            clearTimeout(toastTimer);
            toastTimer = setTimeout(() => el.toast.classList.remove('on'), kind === 'error' ? 4200 : 2400);
        }

        const batch = { groupId: '', here: '', turn: 0, tasks: [], groups: [], rows: [], courses: null, images: new Map(), running: false, stop: false, msg: null, retry: null };
        const batchPicked = () => batch.tasks.filter(t => t.on && t.when !== 'soon');

        function setMode(mode) {
            if (el.zz.dataset.mode !== mode) log('面板', `标签页 → ${mode === 'all' ? '总复习' : '这份作业'}`);
            el.zz.dataset.mode = mode;
            el.main.dataset.sheet = '';
            root.querySelectorAll('.mode').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.m === mode)));
            syncBatch();
        }

        function syncBatch() {
            if (!root || batch.running || guideStep || el.zz.dataset.open !== '1' || el.zz.dataset.mode !== 'all') return;
            const here = location.pathname.match(/\/(?:mycourse|course)\/(\d+)/)?.[1] || '';
            if (here && here !== batch.here) {
                log('总复习', `网址里的课程是 ${here}（上次 ${batch.here || '无'}），读它的清单`);
                batch.here = here;
                showCourse(here);
            } else if (!batch.turn) {
                log('总复习', '网址里没有课程，先让用户选', location.pathname);
                pickCourse();
            }
        }

        function batchState(state, text = '', retry = null, swap = false) {
            log('总复习', `界面 → ${state}`, text);
            el.batch.dataset.state = state;
            el.bHint.textContent = text;
            batch.retry = retry;
            el.bReload.hidden = !retry;
            el.bSwap.hidden = !swap;
        }

        async function pickCourse() {
            const turn = ++batch.turn;
            if (!batch.courses) {
                batchState('hint', '正在读取课程…');
                try {
                    const courses = await loadCourses();
                    if (turn !== batch.turn) return;
                    batch.courses = courses;
                } catch (e) {
                    if (turn === batch.turn) batchState('hint', `课程没读到：${e.message}`, pickCourse);
                    return;
                }
                el.bPick.innerHTML = batch.courses.map(c => `<button class="pk" type="button" data-act="b-course" data-id="${esc(c.id)}"><span>${esc(c.name)}</span><small>${esc(c.term)}</small></button>`).join('');
            }
            if (batch.courses.length) batchState('pick');
            else batchState('hint', '没有读到本学期的课程。');
        }

        async function showCourse(groupId) {
            const turn = ++batch.turn;
            Object.assign(batch, { groupId, tasks: [], groups: [], rows: [], images: new Map(), msg: null });
            renderCourse();
            loadCourse(groupId);
            batchState('hint', '正在读取这门课的作业清单…');
            try {
                const tasks = await loadTasks(groupId);
                if (turn !== batch.turn) return;
                if (!tasks.length) {
                    batchState('hint', '这门课没有作业、练习或测验。', null, true);
                    return;
                }
                tasks.forEach(t => { t.on = t.when === 'ended'; });
                batch.tasks = tasks;
                buildBatch();
                batchState('list');
            } catch (e) {
                if (turn === batch.turn) batchState('hint', `清单没读到：${e.message}`, () => showCourse(groupId), true);
            }
        }

        function buildBatch() {
            const { tasks } = batch;
            batch.groups = [];
            tasks.forEach((t, i) => {
                const last = batch.groups[batch.groups.length - 1];
                if (last && last.name === t.chapter) last.items.push(i);
                else {
                    batch.groups.push({ name: t.chapter, items: [i] });
                    t.first = i > 0;
                }
            });
            el.bList.innerHTML = batch.groups.map(g => `<section class="ch"><label class="ch-h"><input class="ck" type="checkbox"><span class="ch-n">${esc(g.name || '未分组')}</span><em></em></label>${
                g.items.map(i => `<label class="it"><input class="ck" type="checkbox"${tasks[i].when === 'soon' ? ' disabled' : ''}><span class="it-n" title="${esc(tasks[i].name)}">${esc(tasks[i].name)}</span><span class="it-s"></span></label>`).join('')}</section>`).join('');
            el.strip.innerHTML = tasks.map(t => `<i${t.first ? ' class="first"' : ''}></i>`).join('');
            batch.rows = [...el.bList.querySelectorAll('.it')];
            el.bList.querySelectorAll('.ch-h').forEach((head, c) => { batch.groups[c].head = head; });
            paintBatch();
        }

        function taskTag(t, state) {
            if (state === 'wait') return '等待';
            if (state === 'run') return '读取中';
            if (state === 'fail') return `没读到：${esc(t.error)}`;
            if (state === 'ok') {
                const r = t.paper.result;
                return `${t.paper.questions.length} 题${r ? `<b class="it-sc">${esc(r.score ?? '-')}</b>分` : '　没交'}`;
            }
            return t.when === 'soon' ? '未开始' : `${t.when === 'open' ? '<b class="it-open">进行中</b>' : ''}${t.kind}`;
        }

        function paintBatch() {
            const { tasks } = batch;
            const picked = batchPicked().length;
            const mark = (box, list) => {
                const can = list.filter(t => t.when !== 'soon');
                const on = can.filter(t => t.on).length;
                box.checked = on > 0 && on === can.length;
                box.indeterminate = on > 0 && on < can.length;
                box.disabled = !can.length;
                return `${on}/${can.length}`;
            };
            tasks.forEach((t, i) => {
                const state = t.s || (t.paper ? 'ok' : t.error ? 'fail' : 'idle');
                const row = batch.rows[i];
                row.dataset.s = state;
                row.dataset.on = t.on ? '1' : '0';
                row.firstElementChild.checked = t.on;
                row.lastElementChild.innerHTML = taskTag(t, state);
                row.lastElementChild.title = t.error || '';
                el.strip.children[i].className = `${t.first ? 'first ' : ''}${!t.on ? '' : state === 'idle' || state === 'wait' ? 'on' : state}`;
            });
            batch.groups.forEach(g => { g.head.lastElementChild.textContent = mark(g.head.firstElementChild, g.items.map(i => tasks[i])); });
            mark(el.bAll, tasks);
            el.bCount.innerHTML = `已选 <b>${picked}</b> / ${tasks.length} 份`;
            el.batch.dataset.run = batch.running ? '1' : '0';
            if (batch.running) return;
            label(el.bGo, `导出 ${picked} 份`);
            el.bGo.disabled = !picked;
            const fmt = prefs.fmt.toUpperCase();
            const note = !picked ? '先勾选要导出的作业。'
                : prefs.pack === 'one' ? `合成一个 ${fmt}，带目录，每份另起一页。`
                : fmt === 'DOC' ? '每份一个 DOC，打包成一个压缩包下载。'
                : `每份一个 PDF。浏览器会连续弹出 ${picked} 次保存窗口，要逐个点保存。`;
            el.bMsg.innerHTML = batch.msg ? batch.msg.html : note;
            el.bMsg.dataset.kind = batch.msg ? batch.msg.kind : '';
        }

        function onCheck(event) {
            const box = event.target;
            if (!box.classList.contains('ck')) return;
            if (!batch.running) {
                const row = box.closest('.it');
                const group = batch.groups.find(g => g.head === box.parentElement);
                const list = row ? [batch.tasks[batch.rows.indexOf(row)]] : group ? group.items.map(i => batch.tasks[i]) : batch.tasks;
                list.forEach(t => { if (t.when !== 'soon') t.on = box.checked; });
                batch.msg = null;
                log('面板', box.checked ? '勾上' : '取消', row ? `「${list[0].name}」` : group ? `整章「${group.name || '未分组'}」` : '全选', `现在选了 ${batchPicked().length} / ${batch.tasks.length} 份`);
            } else log('面板', '正在读取，勾选不生效');
            paintBatch();
        }

        async function runBatch() {
            const picked = batchPicked();
            const started = Date.now();
            log('总复习', `点了导出：选了 ${picked.length} 份（已经读过的 ${picked.filter(t => t.paper).length} 份），打包=${prefs.pack} 格式=${prefs.fmt} 附答案=${prefs.withAnswers} 答案位置=${prefs.answerAt}，课程 ${batch.groupId}「${getCourse(batch.groupId)}」`);
            let win = null;
            try {
                if (prefs.fmt === 'pdf') win = openPrintWindow();
            } catch (e) {
                toast(e.message, 'error');
                return;
            }
            const { groupId, images } = batch;
            const course = getCourse(groupId) || '课程';
            const say = text => {
                el.bMsg.textContent = text;
                el.bMsg.dataset.kind = '';
                if (win && !win.closed) win.document.body.textContent = text;
            };
            const halted = () => batch.stop || !!win?.closed;
            Object.assign(batch, { running: true, stop: false, msg: null });
            picked.forEach(t => {
                t.error = '';
                t.s = t.paper ? '' : 'wait';
            });
            label(el.bGo, '停止');
            for (const [k, t] of picked.entries()) {
                if (halted()) {
                    log('总复习', `读到第 ${k + 1} 份前停下：${batch.stop ? '用户点了停止' : '打印窗口被关掉了'}`);
                    break;
                }
                if (t.paper) continue;
                t.s = 'run';
                paintBatch();
                say(`正在读取第 ${k + 1} / ${picked.length} 份：${t.name}`);
                const row = batch.rows[batch.tasks.indexOf(t)];
                el.bList.scrollTop += row.getBoundingClientRect().top - el.bList.getBoundingClientRect().top - el.bList.clientHeight / 2;
                const t0 = Date.now();
                log('读取', `第 ${k + 1} / ${picked.length} 份`, taskLine(t), `本页 ${document.visibilityState}`);
                try {
                    const p = await readPaper(groupId, t);
                    await inlineImages(p.images, images);
                    t.paper = p;
                    log('读取', `第 ${k + 1} 份读好了，用了 ${Date.now() - t0}ms`);
                } catch (e) {
                    t.error = e.message;
                    log('读取', `第 ${k + 1} 份没读到，用了 ${Date.now() - t0}ms`, e);
                    console.warn(`[${NAME}] 没读到「${t.name}」`, e);
                }
                t.s = '';
            }
            picked.forEach(t => { t.s = ''; });
            paintBatch();
            const ready = picked.filter(t => t.paper);
            const failed = picked.filter(t => t.error).length;
            log('总复习', `读取结束：读到 ${ready.length} 份，没读到 ${failed} 份，用了 ${Math.round((Date.now() - started) / 1000)} 秒，打印窗口${win ? (win.closed ? '已被关掉' : '还开着') : '没有（DOC）'}，停止=${batch.stop}`);
            let msg;
            if (halted()) {
                if (win && !win.closed) win.close();
                msg = { html: `${batch.stop ? '已停止' : '打印窗口被关掉了'}，没有导出。读到的 ${ready.length} 份先留着，再点「导出」会接着读。`, kind: 'warn' };
            } else if (!ready.length) {
                if (win) win.close();
                msg = { html: `一份都没读到：${esc(picked[0].error)}`, kind: 'error' };
            } else {
                say('正在生成文档…');
                try {
                    const { done, noDialog } = await exportTasks(course, ready, images, win, halted);
                    const what = prefs.pack === 'one' ? `合成了一个 ${prefs.fmt.toUpperCase()}` : win ? '每份一个 PDF' : '每份一个 DOC，打成了一个压缩包';
                    if (done < ready.length) {
                        const why = noDialog ? '浏览器没有弹出保存窗口' : batch.stop ? '已停止' : '打印窗口被关掉了';
                        if (batch.stop && !win.closed) win.close();
                        msg = { html: `${why}，${done ? `只导出了前 ${done} 份（共 ${ready.length} 份）` : '没有导出'}。`, kind: 'warn' };
                    } else {
                        msg = { html: `已导出 ${done} 份，${what}。${failed ? `${failed} 份没读到，<button type="button" data-act="b-go">再试一次</button>` : ''}`, kind: failed ? 'warn' : 'ok' };
                    }
                } catch (e) {
                    log('导出', '总复习导出失败', e, String(e?.stack || '').split('\n').slice(0, 4).join(' | '));
                    console.error(`[${NAME}]`, e);
                    if (win && !win.closed) win.document.body.textContent = `导出失败：${e.message}`;
                    msg = { html: `导出失败：${esc(e.message)}`, kind: 'error' };
                }
            }
            Object.assign(batch, { running: false, msg });
            paintBatch();
            log('总复习', `导出流程结束，一共 ${Math.round((Date.now() - started) / 1000)} 秒。面板上写的是：${el.bMsg.textContent}`);
        }

        function status() {
            const b = batch;
            return [
                `面板：${el.zz.dataset.open === '1' ? '展开' : '收起'} 标签页=${el.zz.dataset.mode} 风格=${el.zz.dataset.theme} 引导=${guideStep} 成绩面板=${el.zz.dataset.result} 抽屉=${el.main.dataset.sheet || '无'} 位置 right=${el.zz.style.right} top=${el.zz.style.top}`,
                `总复习：${b.groupId ? `课程 ${b.groupId}「${getCourse(b.groupId)}」` : '还没有课程'} 界面=${el.batch.dataset.state}${el.bHint.textContent ? `（${el.bHint.textContent}）` : ''} 任务 ${b.tasks.length} 个，选了 ${batchPicked().length}，读到 ${b.tasks.filter(t => t.paper).length}，没读到 ${b.tasks.filter(t => t.error).length}，图片 ${b.images.size} 张，${b.running ? '正在读取' : '空闲'}`,
                ...b.tasks.map(t => `  ${t.on ? '[x]' : '[ ]'} ${taskLine(t)}${t.s ? ` ${t.s}` : ''}${t.paper ? ` 已读 ${t.paper.questions.length} 题` : ''}${t.error ? ` 没读到：${t.error}` : ''}`),
            ];
        }

        function place(full) {
            if (!root) return;
            const open = el.zz.dataset.open === '1';
            const both = open && el.zz.dataset.result === '1' && !guideStep;
            if (full) el.main.style.maxHeight = '';
            const bothWidth = el.main.offsetWidth + el.result.offsetWidth + 12;
            const narrow = both && innerWidth < bothWidth + MARGIN * 2;
            el.zz.classList.toggle('narrow', narrow);
            const box = open ? el.main : el.trigger;
            const width = both && !narrow ? bothWidth : box.offsetWidth;
            const right = Math.min(Math.max(prefs.right, MARGIN), Math.max(MARGIN, innerWidth - width - MARGIN));
            el.zz.style.right = `${right}px`;
            if (!full && open && el.zz.style.top) return;
            const top = Math.min(Math.max(prefs.top, MARGIN), Math.max(MARGIN, innerHeight - box.offsetHeight - MARGIN));
            el.zz.style.top = `${top}px`;
            if (open) el.main.style.maxHeight = `${innerHeight - top - MARGIN}px`;
        }

        function setOpen(open) {
            clearTimeout(closeTimer);
            if (open) {
                el.zz.classList.remove('leave');
                el.zz.dataset.open = '1';
                el.zz.classList.add('enter');
                place(true);
                log('面板', `展开：标签页=${el.zz.dataset.mode} 位置 right=${el.zz.style.right} top=${el.zz.style.top} 窗口 ${innerWidth}×${innerHeight}`, location.pathname);
                if (noticeUnread()) { prefs.seen = noticeKey(); savePrefs(); renderTrigger(); }
                syncBatch();
            } else {
                log('面板', '收起');
                el.main.dataset.sheet = '';
                el.zz.classList.remove('enter');
                el.zz.classList.add('leave');
                closeTimer = setTimeout(() => {
                    el.zz.classList.remove('leave');
                    el.zz.dataset.open = '0';
                    el.nTag.classList.toggle('unread', noticeUnread());
                    place(true);
                }, 140);
            }
        }

        function drag(handle, isTrigger) {
            handle.addEventListener('pointerdown', event => {
                if (event.button !== 0 || (!isTrigger && event.target.closest('button'))) return;
                const rect = el.zz.getBoundingClientRect();
                const start = { x: event.clientX, y: event.clientY, right: innerWidth - rect.right, top: rect.top };
                let moved = false;
                handle.setPointerCapture(event.pointerId);
                const move = e => {
                    const dx = e.clientX - start.x;
                    const dy = e.clientY - start.y;
                    if (!moved && Math.hypot(dx, dy) < 4) return;
                    moved = true;
                    el.zz.dataset.dragging = '1';
                    prefs.right = start.right - dx;
                    prefs.top = start.top + dy;
                    place(true);
                };
                const up = () => {
                    handle.removeEventListener('pointermove', move);
                    handle.removeEventListener('pointerup', up);
                    handle.removeEventListener('pointercancel', up);
                    delete el.zz.dataset.dragging;
                    if (!moved) return;
                    const r = el.zz.getBoundingClientRect();
                    prefs.right = innerWidth - r.right;
                    prefs.top = r.top;
                    log('面板', `拖到 right=${Math.round(prefs.right)} top=${Math.round(prefs.top)}`);
                    savePrefs();
                    if (isTrigger) handle.addEventListener('click', e => e.stopImmediatePropagation(), { capture: true, once: true });
                };
                handle.addEventListener('pointermove', move);
                handle.addEventListener('pointerup', up);
                handle.addEventListener('pointercancel', up);
            });
        }

        async function busy(button, text, task) {
            const original = button.querySelector('span').textContent;
            button.disabled = true;
            label(button, text);
            try { await task(); } catch (e) { toast(e.message, 'error'); console.error(`[${NAME}]`, e); }
            finally { button.disabled = false; label(button, original); }
        }

        async function save(button) {
            const p = paper;
            const c = check();
            if (!c.jobs.length) {
                setMsg(c.issues.length ? '答案格式有误，按上面的提示改一下再保存。' : '没有识别到答案。每题要以「题号 =>」开头。', 'error');
                return;
            }
            saving = true;
            button.disabled = true;
            el.bar.classList.add('on');
            el.barFill.style.width = '0';
            setMsg('正在读取作答记录…');
            let reloading = false;
            try {
                failures = await saveAnswers(p, c.jobs, (done, total) => {
                    label(button, `正在保存 ${done} / ${total}`);
                    el.barFill.style.width = `${done / total * 100}%`;
                });
                const saved = c.jobs.length - failures.length;
                check();
                if (!failures.length && !c.issues.length) {
                    reloading = true;
                    label(button, '已保存');
                    setMsg(`已保存 ${saved} 题，正在刷新页面…`, 'ok');
                    setTimeout(() => {
                        log('保存', '全部保存成功，刷新页面');
                        saveLog();
                        location.reload();
                    }, 1200);
                    return;
                }
                const parts = [`已保存 ${saved} 题`];
                if (failures.length) parts.push(`${failures.length} 题保存失败`);
                if (c.issues.length) parts.push(`${c.issues.length} 题格式有误没有保存`);
                setMsg(`${parts.join('，')}。改好后再保存一次即可，页面没有刷新。`, 'warn');
            } catch (e) {
                setMsg(e.message, 'error');
            } finally {
                saving = false;
                el.bar.classList.remove('on');
                if (!reloading) {
                    button.disabled = false;
                    label(button, '保存作答记录');
                }
            }
        }

        function setMsg(text, kind) {
            log('保存提示', kind, text);
            el.sMsg.textContent = text;
            if (kind) el.sMsg.dataset.kind = kind;
            else delete el.sMsg.dataset.kind;
        }

        function onClick(event) {
            const t = event.target.closest('[data-act]');
            if (!t) return;
            const p = paper;
            if (t.dataset.act !== 'log') log('面板', `点「${t.dataset.act}」`, Object.entries(t.dataset).filter(([key]) => key !== 'act').map(([key, value]) => `${key}=${value}`).join(' '));
            switch (t.dataset.act) {
                case 'log':
                    GM_setClipboard(logText(LOG_COPY), 'text');
                    toast(`诊断日志已复制（最近 ${LOG_COPY} 条）。双击版本号可以下载完整日志`);
                    break;
                case 'open': setOpen(true); break;
                case 'close': setOpen(false); break;
                case 'theme': setTheme(el.zz.dataset.theme === 'tape' ? 'zhu' : 'tape'); break;
                case 'pick-theme': setTheme(t.dataset.theme); break;
                case 'guide-next':
                    if (!prefs.theme) setTheme('tape');
                    guideStep = 2;
                    renderGuide();
                    break;
                case 'guide-back': guideStep = 1; renderGuide(); break;
                case 'guide-done':
                    guideStep = 0;
                    renderGuide();
                    place(true);
                    syncBatch();
                    break;
                case 'result': {
                    if (!p?.result) return;
                    const show = el.zz.dataset.result !== '1';
                    el.zz.dataset.result = show ? '1' : '0';
                    if (show) { el.result.classList.remove('r-enter'); void el.result.offsetWidth; el.result.classList.add('r-enter'); }
                    place(true);
                    break;
                }
                case 'filter': setFilter(t.dataset.f); break;
                case 'notice': {
                    const open = el.notice.dataset.open !== '1';
                    el.notice.dataset.open = open ? '1' : '0';
                    t.textContent = open ? '收起' : '展开';
                    break;
                }
                case 'sheet':
                    el.main.dataset.sheet = el.main.dataset.sheet === t.dataset.vOpen ? '' : t.dataset.vOpen;
                    if (el.main.dataset.sheet === 'img') images();
                    break;
                case 'sheet-close': el.main.dataset.sheet = ''; break;
                case 'seg': {
                    const seg = t.parentElement;
                    prefs[seg.dataset.pref] = t.dataset.val;
                    savePrefs();
                    prefsToControls();
                    batch.msg = null;
                    paintBatch();
                    break;
                }
                case 'switch':
                    prefs.withAnswers = !prefs.withAnswers;
                    savePrefs();
                    prefsToControls();
                    batch.msg = null;
                    paintBatch();
                    break;
                case 'mode': setMode(t.dataset.m); break;
                case 'b-swap': pickCourse(); break;
                case 'b-course': {
                    const course = batch.courses.find(c => c.id === t.dataset.id);
                    setCourse(course.id, course.name);
                    showCourse(course.id);
                    break;
                }
                case 'b-reload': batch.retry(); break;
                case 'b-go':
                    if (!batch.running) runBatch();
                    else {
                        log('总复习', '点了停止');
                        batch.stop = true;
                        label(el.bGo, '正在停止…');
                    }
                    break;
                case 'copy':
                    GM_setClipboard(buildPrompt(p), 'text');
                    label(t, `已复制 ${p.questions.length} 题`);
                    clearTimeout(t.timer);
                    t.timer = setTimeout(() => label(t, '复制题目给 AI'), 1600);
                    break;
                case 'save': if (!saving) save(t); break;
                case 'ai-pdf': busy(t, '正在生成…', () => printDocument('ai')); break;
                case 'hw-pdf': busy(t, '生成中…', () => printDocument('homework')); break;
                case 'hw-doc': busy(t, '生成中…', async () => { await downloadDoc(); toast('已下载 DOC，用 Word 或 WPS 打开'); }); break;
                case 'hw-text':
                    GM_setClipboard(buildHomeworkText(p), 'text');
                    toast('已复制纯作业文本');
                    break;
                case 'img-copy': {
                    const img = p.images[t.dataset.i];
                    busy(t, '复制中…', async () => {
                        try {
                            await copyImage(img.src);
                            toast('图片已复制');
                        } catch (e) {
                            GM_setClipboard(img.src, 'text');
                            toast('浏览器不让复制图片，已改为复制图片链接', 'error');
                        }
                    });
                    break;
                }
                case 'img-link':
                    GM_setClipboard(p.images[t.dataset.i].src, 'text');
                    toast('图片链接已复制');
                    break;
            }
        }

        function bind() {
            root.addEventListener('click', onClick);
            root.addEventListener('change', onCheck);
            root.addEventListener('dblclick', event => {
                if (!event.target.closest('[data-act="log"]')) return;
                saveFile(new Blob([logText()], { type: 'text/plain;charset=utf-8' }), `${NAME}日志-v${VERSION}-${stamp()}.txt`);
                toast('完整诊断日志已下载');
            });
            el.input.addEventListener('input', () => { failures = []; check(); });
            el.courseInput.addEventListener('input', () => { const p = paper; if (p) setCourse(p.groupId, el.courseInput.value); });
            el.zz.addEventListener('animationend', event => {
                if (event.animationName !== 'zz-in') return;
                el.zz.classList.remove('enter');
                el.result.classList.remove('r-enter');
            });
            drag(el.trigger, true);
            drag($('.head'), false);
            addEventListener('resize', () => place(true));
            new ResizeObserver(() => place(false)).observe(el.shell);
        }

        return { mount, paper: renderPaper, course: renderCourse, notice: renderNotice, route: syncBatch, status };
    })();

    log(`──────── 页面加载 ${location.host}${location.pathname} v${VERSION} ────────`);
    page.addEventListener('error', e => log('报错', e.message, e.filename ? `${e.filename.split('?')[0].split('/').pop()}:${e.lineno}` : ''));
    page.addEventListener('unhandledrejection', e => log('报错', '没人处理的 Promise 错误', e.reason));
    page.document.addEventListener('visibilitychange', () => log('页面', `可见性变了：${page.document.visibilityState}，${page.document.hasFocus() ? '有焦点' : '没有焦点'}`));
    page.addEventListener('pagehide', saveLog);
    hookRequests();
    watchRoute();
    dropLegacyKeys();
    loadNotice();
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', view.mount, { once: true });
    else view.mount();
})();
