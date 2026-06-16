// ==UserScript==
// @name         小雅粘粘粘
// @namespace    http://tampermonkey.net/
// @author       Qy
// @version      1.8
// @description  小雅粘粘粘：提取题目、生成 AI 作答模板，并保存作答记录
// @match        *://*.ai-augmented.com/*
// @grant        GM_setClipboard
// @grant        GM_xmlhttpRequest
// @connect      *.ai-augmented.com
// @connect      *.aliyuncs.com
// @connect      xiaoya-notice-dwafgrs416f1w156r1fasd11jt.qyrun.me
// @icon         data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDI0IDEwMjQiPgogIDxkZWZzPgogICAgPGxpbmVhckdyYWRpZW50IGlkPSJiZyIgeDE9IjAiIHkxPSIwIiB4Mj0iMSIgeTI9IjEiPgogICAgICA8c3RvcCBvZmZzZXQ9IjAiIHN0b3AtY29sb3I9IiMxNTFhMWEiLz4KICAgICAgPHN0b3Agb2Zmc2V0PSIxIiBzdG9wLWNvbG9yPSIjMjAyNzI3Ii8+CiAgICA8L2xpbmVhckdyYWRpZW50PgogIDwvZGVmcz4KICA8cmVjdCB4PSI2NCIgeT0iNjQiIHdpZHRoPSI4OTYiIGhlaWdodD0iODk2IiByeD0iMjEwIiBmaWxsPSJ1cmwoI2JnKSIvPgogIDxwYXRoIGZpbGw9IiNmNGYwZTgiIGQ9Ik0xOTAgMTcwaDE0MmwxMjMgMjE0LTk3IDEyNHoiLz4KICA8cGF0aCBmaWxsPSIjZjRmMGU4IiBkPSJNNzE0IDE3MGgxNDBMNDI4IDc5MkgyODZ6Ii8+CiAgPHBhdGggZmlsbD0iIzNkYjg3YyIgZD0iTTUwOCA2NjBoMzA0djEzMkg0MTZ6Ii8+Cjwvc3ZnPg==
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';
    const SCRIPT_NAME = "小雅粘粘粘";
    const SCRIPT_VERSION = "1.8";
    console.log(`[${SCRIPT_NAME} v${SCRIPT_VERSION}] 脚本已启动`);
    let globalQuestionsData =[];
    let globalExtractedText = "";
    let globalImageAssets = [];
    let globalPdfQuestions = [];
    let globalQuestionSections = [];
    let globalPaperMeta = { title: '', totalScore: null };
    let globalCourseMeta = { groupId: '', courseName: '', loading: false, error: '' };
    let globalSubmissionResult = { state: 'waiting', message: '等待题目数据加载...' };
    let resultPanelVisible = false;
    let resultFilter = 'all';
    let imageDrawerVisible = false;
    let homeworkDrawerVisible = false;
    let homeworkExportOptions = { headerMode: 'course_homework', includeAnswers: false, answerPosition: 'inline' };
    let activeTaskKey = "";
    let panelExpanded = false;
    let lastTriggerWidth = 170;
    let uiTransitionToken = 0;
    let uiTransitionTimer = null;
    let resultPanelTransitionTimer = null;
    let noticeState = {
        content: '公告加载中...',
        version: '',
        updatedAt: '',
        fetchedAt: 0,
        hasUnread: false,
        loading: false,
        error: ''
    };
    let globalGroupId = "";
    let globalNodeId = "";
    let globalPaperId = "";
    let globalRecordId = "";
    let globalToken = "";
    const UI_POSITION_KEY = "xy_magic_box_position_v16";
    const LEGACY_UI_POSITION_KEY = "xy_magic_box_position_v13";
    const DEFAULT_TRIGGER_WIDTH = 170;
    const UI_MARGIN = 8;
    const NOTICE_API = "https://xiaoya-notice-dwafgrs416f1w156r1fasd11jt.qyrun.me/notice";
    const NOTICE_CHANNEL = "zhanzhanzhan";
    const NOTICE_CACHE_KEY = "xy_zhanzhanzhan_notice_cache_v1";
    const NOTICE_READ_KEY = "xy_zhanzhanzhan_notice_read_v1";
    const NOTICE_CACHE_TTL = 6 * 60 * 60 * 1000;
    const PDF_SAVE_TIP = '请选择浏览器内置的“保存为 PDF / 另存为 PDF”。';
    const HOMEWORK_EXPORT_OPTIONS_KEY = "xy_homework_export_options_v18";
    const COURSE_NAME_CACHE_PREFIX = "xy_course_name_v18_";
    const originalXHROpen = XMLHttpRequest.prototype.open;
    const originalXHRSend = XMLHttpRequest.prototype.send;
    const originalFetch = window.fetch;
    function capturePaperRequestParams(rawUrl) {
        try {
            const urlObj = new URL(rawUrl, window.location.origin);
            globalGroupId = urlObj.searchParams.get('group_id') || globalGroupId;
            globalNodeId = urlObj.searchParams.get('node_id') || globalNodeId;
            globalPaperId = urlObj.searchParams.get('paper_id') || globalPaperId;
        } catch (e) {
            console.warn(`[${SCRIPT_NAME}] 无法解析题目数据请求参数`, e);
        }
    }
    function getGroupIdFromGroupRequestUrl(rawUrl) {
        try {
            const urlObj = new URL(rawUrl, window.location.origin);
            const match = urlObj.pathname.match(/\/api\/jx-iresource\/group\/queryGroup\/([^/]+)/);
            return match && match[1] ? decodeURIComponent(match[1]) : '';
        } catch (e) {
            console.warn(`[${SCRIPT_NAME}] 无法解析课程信息请求参数`, e);
            return '';
        }
    }
    function captureGroupRequestParams(rawUrl) {
        const capturedGroupId = getGroupIdFromGroupRequestUrl(rawUrl);
        if (!capturedGroupId) return '';
        if (globalGroupId && capturedGroupId !== globalGroupId && (activeTaskKey || globalQuestionsData.length > 0)) {
            console.warn(`[${SCRIPT_NAME}] 已忽略非当前任务课程信息：${capturedGroupId}`);
            return '';
        }
        globalGroupId = capturedGroupId || globalGroupId;
        return capturedGroupId;
    }
    async function parseFetchResponseAsJson(response) {
        try {
            return await response.clone().json();
        } catch (jsonError) {
            const text = await response.clone().text();
            return JSON.parse(text);
        }
    }
    function buildTaskKey(groupId, nodeId, paperId) {
        return [groupId || '', nodeId || '', paperId || ''].join(':');
    }
    function processCapturedJson(rawUrl, jsonData) {
        if (!rawUrl) return;
        if (rawUrl.includes("/queryStuPaper/v2")) {
            processPaperData(jsonData);
            return;
        }
        if (rawUrl.includes("/api/jx-iresource/group/queryGroup/")) {
            const capturedGroupId = captureGroupRequestParams(rawUrl);
            if (!capturedGroupId) return;
            applyCourseInfo(jsonData?.data || jsonData, 'capture');
        }
    }
    function resetCapturedTaskState(reason = '') {
        if (!activeTaskKey && globalQuestionsData.length === 0) return;
        console.log(`[${SCRIPT_NAME}] 已清空当前任务缓存${reason ? `：${reason}` : ''}`);
        globalQuestionsData = [];
        globalExtractedText = "";
        globalImageAssets = [];
        globalPdfQuestions = [];
        globalQuestionSections = [];
        globalPaperMeta = { title: '', totalScore: null };
        globalCourseMeta = { groupId: '', courseName: '', loading: false, error: '' };
        globalSubmissionResult = { state: 'waiting', message: '等待题目数据加载...' };
        resultPanelVisible = false;
        resultFilter = 'all';
        imageDrawerVisible = false;
        homeworkDrawerVisible = false;
        globalGroupId = "";
        globalNodeId = "";
        globalPaperId = "";
        globalRecordId = "";
        activeTaskKey = "";
        updateUIPanelData();
    }
    function currentUrlMatchesActiveTask() {
        if (!activeTaskKey) return true;
        const href = window.location.href;
        try {
            const urlObj = new URL(href, window.location.origin);
            const groupParam = urlObj.searchParams.get('group_id');
            const nodeParam = urlObj.searchParams.get('node_id');
            const paperParam = urlObj.searchParams.get('paper_id');
            if (groupParam && globalGroupId && groupParam !== globalGroupId) return false;
            if (nodeParam && globalNodeId && nodeParam !== globalNodeId) return false;
            if (paperParam && globalPaperId && paperParam !== globalPaperId) return false;
        } catch (e) {
        }
        const requiredIds = [globalGroupId, globalNodeId].filter(Boolean);
        if (requiredIds.length > 0 && !requiredIds.every(id => href.includes(id))) return false;
        if (globalPaperId && href.includes('paper_id') && !href.includes(globalPaperId)) return false;
        return true;
    }
    function handleRouteChange() {
        setTimeout(() => {
            if (!currentUrlMatchesActiveTask()) {
                resetCapturedTaskState('页面路由已离开当前作业任务');
            }
        }, 80);
    }
    function installRouteWatcher() {
        if (installRouteWatcher.installed) return;
        installRouteWatcher.installed = true;
        const wrapHistoryMethod = methodName => {
            const original = history[methodName];
            if (typeof original !== 'function') return;
            history[methodName] = function(...args) {
                const result = original.apply(this, args);
                handleRouteChange();
                return result;
            };
        };
        wrapHistoryMethod('pushState');
        wrapHistoryMethod('replaceState');
        window.addEventListener('popstate', handleRouteChange);
        window.addEventListener('hashchange', handleRouteChange);
    }
    XMLHttpRequest.prototype.open = function(method, url, ...args) {
        this._requestUrl = typeof url === 'string' ? url : url.toString();
        return originalXHROpen.apply(this,[method, url, ...args]);
    };
    XMLHttpRequest.prototype.send = function(...args) {
        this.addEventListener('load', function() {
            try {
                if (this._requestUrl && this._requestUrl.includes("/queryStuPaper/v2")) {
                    console.log(`[${SCRIPT_NAME}] 已捕获题目数据包`);
                    capturePaperRequestParams(this._requestUrl);
                    if (this.responseType === 'blob' && this.response) {
                        this.response.text().then(text => processCapturedJson(this._requestUrl, JSON.parse(text)));
                    } else if (this.responseType === 'json' && this.response) {
                        processCapturedJson(this._requestUrl, this.response);
                    } else if ((this.responseType === '' || this.responseType === 'text') && this.responseText) {
                        processCapturedJson(this._requestUrl, JSON.parse(this.responseText));
                    }
                } else if (this._requestUrl && this._requestUrl.includes("/api/jx-iresource/group/queryGroup/")) {
                    captureGroupRequestParams(this._requestUrl);
                    if (this.responseType === 'blob' && this.response) {
                        this.response.text().then(text => processCapturedJson(this._requestUrl, JSON.parse(text)));
                    } else if (this.responseType === 'json' && this.response) {
                        processCapturedJson(this._requestUrl, this.response);
                    } else if ((this.responseType === '' || this.responseType === 'text') && this.responseText) {
                        processCapturedJson(this._requestUrl, JSON.parse(this.responseText));
                    }
                }
            } catch (e) {
                console.error("[解包失败]", e);
            }
        });
        return originalXHRSend.apply(this, args);
    };
    window.fetch = async function(input, init) {
        const response = await originalFetch.apply(this, arguments);
        try {
            const rawUrl = typeof input === 'string' ? input : (input && input.url ? input.url : String(input));
            if (rawUrl && rawUrl.includes("/queryStuPaper/v2")) {
                console.log(`[${SCRIPT_NAME}] 已捕获 fetch 题目数据包`);
                capturePaperRequestParams(rawUrl);
                parseFetchResponseAsJson(response)
                    .then(jsonData => processCapturedJson(rawUrl, jsonData))
                    .catch(e => console.error(`[${SCRIPT_NAME}] fetch 数据解包失败`, e));
            } else if (rawUrl && rawUrl.includes("/api/jx-iresource/group/queryGroup/")) {
                captureGroupRequestParams(rawUrl);
                parseFetchResponseAsJson(response)
                    .then(jsonData => processCapturedJson(rawUrl, jsonData))
                    .catch(e => console.error(`[${SCRIPT_NAME}] fetch 数据解包失败`, e));
            }
        } catch (e) {
            console.error(`[${SCRIPT_NAME}] fetch 拦截处理失败`, e);
        }
        return response;
    };
    function normalizeEntityMap(entityMap) {
        if (!entityMap || typeof entityMap !== 'object') return {};
        return entityMap;
    }
    function getEntityByKey(entityMap, key) {
        const normalizedMap = normalizeEntityMap(entityMap);
        if (Object.prototype.hasOwnProperty.call(normalizedMap, key)) return normalizedMap[key];
        const stringKey = String(key);
        if (Object.prototype.hasOwnProperty.call(normalizedMap, stringKey)) return normalizedMap[stringKey];
        return null;
    }
    function getDataType(data = {}) {
        return String(data.type || data.blockType || data.kind || '').toUpperCase();
    }
    function getImageSrcFromData(data = {}) {
        const type = getDataType(data);
        return data.src || data.imageUrl || data.image_url || data?.data?.src || data?.data?.imageUrl || data?.data?.image_url ||
            ((type.includes('IMAGE') || type === 'IMG') ? (data.url || data.href || data?.data?.url || data?.data?.href || '') : '');
    }
    function getFormulaFromData(data = {}) {
        return data.teX || data.tex || data.latex || data.formula || data.value || data.content || data.text || data?.data?.teX || data?.data?.tex || data?.data?.latex || '';
    }
    function isImageData(data = {}) {
        const type = getDataType(data);
        return type.includes('IMAGE') || type === 'IMG' || !!data.src || !!data.imageUrl || !!data.image_url || !!data?.data?.src;
    }
    function isFormulaData(data = {}) {
        const type = getDataType(data);
        return type.includes('TEX') || type.includes('MATH') || type.includes('FORMULA');
    }
    function parseRichContent(rawContent) {
        if (!rawContent) return { text: "", images: [], segments: [] };
        let contentObject = null;
        if (typeof rawContent === 'string') {
            try {
                contentObject = JSON.parse(rawContent);
            } catch (e) {
                const cleanText = rawContent.replace(/^"|"$/g, '').trim();
                return { text: cleanText, images: [], segments: cleanText ? [{ type: 'text', value: cleanText }] : [] };
            }
        } else if (typeof rawContent === 'object') {
            contentObject = rawContent;
        } else {
            const cleanText = String(rawContent).trim();
            return { text: cleanText, images: [], segments: cleanText ? [{ type: 'text', value: cleanText }] : [] };
        }
        if (!contentObject || !Array.isArray(contentObject.blocks)) {
            const fallbackText = typeof contentObject === 'string' ? contentObject.trim() : (typeof rawContent === 'string' ? rawContent.trim() : JSON.stringify(rawContent));
            return {
                text: fallbackText,
                images: [],
                segments: fallbackText ? [{ type: 'text', value: fallbackText }] : []
            };
        }
        const parts = [];
        const images = [];
        const segments = [];
        const entityMap = normalizeEntityMap(contentObject.entityMap);
        const pushText = (text) => {
            const cleanText = String(text || '').trim();
            if (cleanText) {
                parts.push(cleanText);
                segments.push({ type: 'text', value: cleanText });
            }
        };
        const pushImage = (src) => {
            if (!src) return;
            parts.push(`[图片]`);
            images.push({ src, kind: 'image' });
            segments.push({ type: 'image', src });
        };
        const pushFormula = (formula) => {
            const cleanFormula = String(formula || '').trim();
            if (cleanFormula) {
                parts.push(`[公式: ${cleanFormula}]`);
                segments.push({ type: 'formula', value: cleanFormula });
            }
        };
        const handleMediaData = (data = {}) => {
            if (isImageData(data)) {
                pushImage(getImageSrcFromData(data));
            } else if (isFormulaData(data)) {
                pushFormula(getFormulaFromData(data));
            }
        };
        contentObject.blocks.forEach(block => {
            if (!block) return;
            if (block.type === 'atomic' && block.data) {
                handleMediaData(block.data);
                return;
            }
            pushText(block.text);
            if (Array.isArray(block.entityRanges)) {
                block.entityRanges.forEach(range => {
                    const entity = getEntityByKey(entityMap, range?.key);
                    if (entity && entity.data) handleMediaData({ ...entity.data, type: entity.type || entity.data.type });
                });
            }
        });
        return { text: parts.join('\n').trim(), images, segments };
    }
    function extractTextFromRichJSON(rawContent) {
        return parseRichContent(rawContent).text;
    }
    function collectImageAssets(questionIndex, source, optionLetter, parsedContent) {
        if (!parsedContent || !Array.isArray(parsedContent.images)) return;
        parsedContent.images.forEach(image => {
            if (!image.src) return;
            const duplicated = globalImageAssets.some(asset =>
                asset.questionIndex === questionIndex &&
                asset.source === source &&
                asset.optionLetter === optionLetter &&
                asset.src === image.src
            );
            if (duplicated) return;
            globalImageAssets.push({
                questionIndex,
                source,
                optionLetter,
                src: image.src
            });
        });
    }
    function getQuestionTypeLabel(type) {
        const labels = {
            1: "[单选题]",
            2: "[多选题]",
            4: "[填空题]",
            5: "[判断题]",
            6: "[简答题]",
            7: "[附件题]",
            9: "[题组]",
            13: "[匹配题]"
        };
        return labels[type] || "[其他]";
    }
    function parseMaybeJson(value) {
        if (typeof value !== 'string') return value;
        const trimmed = value.trim();
        if (!trimmed) return value;
        if (/^\d+$/.test(trimmed)) return value;
        try {
            return JSON.parse(trimmed);
        } catch (e) {
            return value;
        }
    }
    function extractPlainAnswerText(value) {
        if (value === null || value === undefined) return '';
        const parsed = parseMaybeJson(value);
        if (parsed && typeof parsed === 'object' && Array.isArray(parsed.blocks)) {
            return parsed.blocks.map(block => block?.text || '').join('\n').trim();
        }
        if (Array.isArray(parsed)) return parsed.map(extractPlainAnswerText).filter(Boolean).join('；');
        if (parsed && typeof parsed === 'object') {
            return Object.values(parsed).map(extractPlainAnswerText).filter(Boolean).join('；');
        }
        return String(parsed).trim();
    }
    function extractRichAnswerDisplay(value) {
        if (value === null || value === undefined || value === '') return '';
        const parsed = parseRichContent(value);
        if (parsed.text) return parsed.text;
        return extractPlainAnswerText(value);
    }
    function toOptionalNumber(value) {
        if (value === null || value === undefined || value === '') return null;
        const num = Number(value);
        return Number.isFinite(num) ? num : null;
    }
    function normalizeAnswerIds(answer) {
        if (Array.isArray(answer)) return answer.map(item => String(item).trim()).filter(Boolean);
        if (answer === null || answer === undefined) return [];
        const parsed = parseMaybeJson(answer);
        if (Array.isArray(parsed)) return parsed.map(item => String(item).trim()).filter(Boolean);
        return String(parsed).split(/[,，、\s]+/).map(item => item.trim()).filter(Boolean);
    }
    function formatChoiceAnswer(qData, answer) {
        const ids = normalizeAnswerIds(answer);
        if (!ids.length) return '未作答';
        return ids.map(id => {
            const option = qData.options?.find(item => String(item.id) === String(id));
            if (!option) return id;
            const text = option.text ? ` ${option.text}` : '';
            return `${option.letter}.${text}`;
        }).join('；');
    }
    function formatFillAnswer(qData, answer) {
        const parsed = parseMaybeJson(answer);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            const text = extractPlainAnswerText(answer);
            return text || '未作答';
        }
        const parts = qData.sortedItems.map((item, index) => {
            const value = extractPlainAnswerText(parsed[item.id]);
            return `空${index + 1}：${value || '未填'}`;
        });
        return parts.length ? parts.join('；') : '未作答';
    }
    function formatMatchingAnswer(qData, answer) {
        const parsed = parseMaybeJson(answer);
        const leftItems = qData.matchingLeftItems || [];
        const rightItems = qData.matchingRightItems || [];
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            const text = extractPlainAnswerText(answer);
            return text || '未作答';
        }
        const rightById = new Map(rightItems.map(item => [String(item.id), item]));
        let hasAnswer = false;
        const lines = leftItems.map(left => {
            const rawValue = parsed[left.id] ?? parsed[String(left.id)];
            const rightIds = normalizeAnswerIds(rawValue);
            if (!rightIds.length) return `${left.letter}. ${left.text || ''} => 未匹配`;
            hasAnswer = true;
            const rightText = rightIds.map(id => {
                const right = rightById.get(String(id));
                return right ? `${right.letter}. ${right.text || ''}` : id;
            }).join('、');
            return `${left.letter}. ${left.text || ''} => ${rightText}`;
        });
        return hasAnswer ? lines.join('\n') : '未作答';
    }
    function formatAnswerForDisplay(qData, answer) {
        if (!qData) return extractPlainAnswerText(answer) || '未作答';
        if (qData.type === 1 || qData.type === 2 || qData.type === 5) return formatChoiceAnswer(qData, answer);
        if (qData.type === 4) return formatFillAnswer(qData, answer);
        if (qData.type === 6) return extractRichAnswerDisplay(answer) || '未作答';
        if (qData.type === 7) return '附件题';
        if (qData.type === 13) return formatMatchingAnswer(qData, answer);
        return extractPlainAnswerText(answer) || '未作答';
    }
    function getSegmentsOrText(parsedContent, fallbackText = '') {
        if (parsedContent?.segments && parsedContent.segments.length) return parsedContent.segments;
        return fallbackText ? [{ type: 'text', value: fallbackText }] : [];
    }
    function getSortedItems(items, sortValue) {
        const rawItems = Array.isArray(items) ? [...items] : [];
        const sortIds = String(sortValue || '').split(',').map(id => id.trim()).filter(Boolean);
        if (!sortIds.length || !rawItems.length) return rawItems;
        const byId = new Map(rawItems.map(item => [String(item?.id), item]));
        const sorted = sortIds.map(id => byId.get(String(id))).filter(Boolean);
        const usedIds = new Set(sorted.map(item => String(item?.id)));
        return sorted.concat(rawItems.filter(item => !usedIds.has(String(item?.id))));
    }
    function getQuestionSubItems(question) {
        const subQuestions = Array.isArray(question?.subQuestions)
            ? question.subQuestions
            : (Array.isArray(question?.sub_questions) ? question.sub_questions : []);
        return getSortedItems(subQuestions, question?.sub_questions_sort);
    }
    function createQuestionArtifacts(q, questionIndex, sectionKey, sectionTitleText) {
        const parsedTitle = parseRichContent(q.title);
        const qTitle = parsedTitle.text;
        const qTypeStr = getQuestionTypeLabel(q.type);
        const resultOptions = [];
        const matchingLeftItems = [];
        const matchingRightItems = [];
        collectImageAssets(questionIndex, 'title', null, parsedTitle);
        const sortedItems = getSortedItems(q.answer_items, q.answer_items_sort);
        const pdfQuestion = {
            index: questionIndex,
            id: q.id,
            type: q.type,
            typeLabel: qTypeStr,
            titleSegments: getSegmentsOrText(parsedTitle, qTitle),
            options: [],
            matchingLeftItems: [],
            matchingRightItems: [],
            blankCount: sortedItems.length,
            sectionKey
        };
        if (q.type === 1 || q.type === 2 || q.type === 5) {
            let letterCharCode = 65;
            sortedItems.forEach(opt => {
                const optionLetter = String.fromCharCode(letterCharCode);
                const parsedOption = parseRichContent(opt.value);
                let optText = parsedOption.text;
                collectImageAssets(questionIndex, 'option', optionLetter, parsedOption);
                if (q.type === 5 && !optText) {
                    optText = optionLetter === 'A' ? '正确' : '错误';
                }
                pdfQuestion.options.push({
                    letter: optionLetter,
                    text: optText,
                    segments: getSegmentsOrText(parsedOption, optText)
                });
                resultOptions.push({
                    id: opt.id,
                    letter: optionLetter,
                    text: optText,
                    answerChecked: opt.answer_checked
                });
                letterCharCode++;
            });
        } else if (q.type === 13) {
            const leftRawItems = sortedItems.filter(item => item && item.is_target_opt !== true);
            const rightRawItems = sortedItems.filter(item => item && item.is_target_opt === true);
            leftRawItems.forEach((opt, itemIndex) => {
                const optionLetter = String.fromCharCode(65 + itemIndex);
                const parsedOption = parseRichContent(opt.value);
                const optText = parsedOption.text;
                const itemData = {
                    id: opt.id,
                    letter: optionLetter,
                    text: optText,
                    answer: opt.answer,
                    segments: getSegmentsOrText(parsedOption, optText)
                };
                collectImageAssets(questionIndex, 'option', optionLetter, parsedOption);
                matchingLeftItems.push(itemData);
                pdfQuestion.matchingLeftItems.push(itemData);
            });
            rightRawItems.forEach((opt, itemIndex) => {
                const optionLetter = String.fromCharCode(97 + itemIndex);
                const parsedOption = parseRichContent(opt.value);
                const optText = parsedOption.text;
                const itemData = {
                    id: opt.id,
                    letter: optionLetter,
                    text: optText,
                    segments: getSegmentsOrText(parsedOption, optText)
                };
                collectImageAssets(questionIndex, 'option', optionLetter, parsedOption);
                matchingRightItems.push(itemData);
                pdfQuestion.matchingRightItems.push(itemData);
            });
        }
        const qData = {
            index: questionIndex,
            id: q.id,
            type: q.type,
            score: q.score,
            titleText: qTitle,
            titleSegments: pdfQuestion.titleSegments,
            typeLabel: qTypeStr,
            sectionKey,
            sectionTitleText,
            options: resultOptions,
            matchingLeftItems,
            matchingRightItems,
            sortedItems
        };
        return { qData, pdfQuestion };
    }
    function normalizePaperQuestions(questionsArray) {
        const sections = [];
        const flattenedQuestions = [];
        const pdfQuestions = [];
        let questionIndex = 1;
        (Array.isArray(questionsArray) ? questionsArray : []).forEach((rawQuestion, rawIndex) => {
            const subQuestions = getQuestionSubItems(rawQuestion);
            const parsedSectionTitle = parseRichContent(rawQuestion.title);
            const sectionTitleText = parsedSectionTitle.text;
            const sectionKey = `section-${rawQuestion?.id || rawIndex}`;
            if (Number(rawQuestion?.type) === 9 && subQuestions.length > 0) {
                const section = {
                    key: sectionKey,
                    titleText: sectionTitleText,
                    titleSegments: getSegmentsOrText(parsedSectionTitle, sectionTitleText),
                    isGroup: true,
                    questionIds: [],
                    questionIndexes: [],
                    questions: []
                };
                collectImageAssets(questionIndex, 'title', null, parsedSectionTitle);
                subQuestions.forEach(subQuestion => {
                    const artifacts = createQuestionArtifacts(subQuestion, questionIndex, sectionKey, sectionTitleText);
                    section.questionIds.push(String(artifacts.qData.id));
                    section.questionIndexes.push(questionIndex);
                    section.questions.push(artifacts.qData);
                    flattenedQuestions.push(artifacts.qData);
                    pdfQuestions.push(artifacts.pdfQuestion);
                    questionIndex++;
                });
                sections.push(section);
                return;
            }
            const section = {
                key: sectionKey,
                titleText: '',
                titleSegments: [],
                isGroup: false,
                questionIds: [],
                questionIndexes: [],
                questions: []
            };
            const artifacts = createQuestionArtifacts(rawQuestion, questionIndex, sectionKey, '');
            section.questionIds.push(String(artifacts.qData.id));
            section.questionIndexes.push(questionIndex);
            section.questions.push(artifacts.qData);
            flattenedQuestions.push(artifacts.qData);
            pdfQuestions.push(artifacts.pdfQuestion);
            sections.push(section);
            questionIndex++;
        });
        return { sections, flattenedQuestions, pdfQuestions };
    }
    function appendPromptQuestion(lines, qData) {
        lines.push(`${qData.index}. ${qData.titleText} ${qData.typeLabel}`);
        if (qData.type === 1 || qData.type === 2 || qData.type === 5) {
            qData.options.forEach(option => {
                lines.push(`   ${option.letter}. ${option.text}`);
            });
        } else if (qData.type === 4) {
            lines.push(`   (本题共 ${qData.sortedItems.length} 个填空)`);
        } else if (qData.type === 7) {
            lines.push(`   附件题无需回答。`);
        } else if (qData.type === 13) {
            lines.push(`   左侧：`);
            qData.matchingLeftItems.forEach(item => lines.push(`   ${item.letter}. ${item.text}`));
            lines.push(``);
            lines.push(`   右侧候选：`);
            qData.matchingRightItems.forEach(item => lines.push(`   ${item.letter}. ${item.text}`));
        }
        lines.push('');
    }
    function buildAiPromptText() {
        const lines = [
            '【小雅粘粘粘：AI 作答模板】'
        ];
        const courseName = getCurrentCourseName();
        if (courseName) lines.push(`课程：${courseName}`);
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
            ''
        );
        globalQuestionSections.forEach(section => {
            if (section.isGroup && section.titleText) {
                lines.push(`【题组】`);
                lines.push(section.titleText);
                lines.push('');
            }
            section.questions.forEach(question => appendPromptQuestion(lines, question));
        });
        return lines.join('\n');
    }
    function getStandardAnswerDisplay(qData, canShowStandardAnswer) {
        if (!canShowStandardAnswer || !qData) return '';
        if (qData.type === 1 || qData.type === 2 || qData.type === 5) {
            const correctOptions = qData.options?.filter(item => item.answerChecked === 2) || [];
            return correctOptions.map(option => {
                const text = option.text ? ` ${option.text}` : '';
                return `${option.letter}.${text}`;
            }).join('；');
        }
        if (qData.type === 4) {
            const parts = qData.sortedItems.map((item, index) => {
                const value = extractPlainAnswerText(item.answer);
                return value ? `空${index + 1}：${value}` : '';
            }).filter(Boolean);
            return parts.join('；');
        }
        if (qData.type === 6 && qData.sortedItems[0]) {
            return extractRichAnswerDisplay(qData.sortedItems[0].answer);
        }
        if (qData.type === 13) {
            const mapping = {};
            (qData.matchingLeftItems || []).forEach(left => {
                if (left.answer) mapping[left.id] = left.answer;
            });
            return Object.keys(mapping).length ? formatMatchingAnswer(qData, mapping) : '';
        }
        return '';
    }
    function getQuestionResultState(answerRecord, qData) {
        if (!answerRecord) return { label: '未作答', tone: 'muted' };
        const score = toOptionalNumber(answerRecord.score);
        const correct = toOptionalNumber(answerRecord.correct);
        const fullScore = toOptionalNumber(qData?.score);
        const hasScore = score !== null;
        const hasFullScore = fullScore !== null && fullScore > 0;
        if (correct === 2 || (hasScore && hasFullScore && score >= fullScore)) {
            return { label: '正确', tone: 'ok' };
        }
        if (hasScore && score > 0) return { label: '部分得分', tone: 'partial' };
        if (correct === 1 || (hasScore && score === 0)) return { label: '错误', tone: 'bad' };
        return { label: '待批改', tone: 'pending' };
    }
    function isConfirmedCorrectAnswer(answerRecord, qData) {
        if (!answerRecord) return false;
        const correct = toOptionalNumber(answerRecord.correct);
        if (correct === 2) return true;
        const score = toOptionalNumber(answerRecord.score);
        const fullScore = toOptionalNumber(qData?.score);
        return score !== null && fullScore !== null && fullScore > 0 && score >= fullScore;
    }
    function getExportAnswerDisplay(qData, answerRecord, canShowStandardAnswer) {
        const standardAnswer = getStandardAnswerDisplay(qData, canShowStandardAnswer);
        if (standardAnswer) return standardAnswer;
        if (isConfirmedCorrectAnswer(answerRecord, qData)) {
            return formatAnswerForDisplay(qData, answerRecord?.answer);
        }
        return '';
    }
    function buildSubmissionResult(paperData) {
        const answerRecord = paperData?.answer_record;
        const answers = answerRecord?.answers;
        if (!answerRecord || !Array.isArray(answers) || answers.length === 0) {
            return {
                state: globalQuestionsData.length ? 'not_submitted' : 'waiting',
                message: globalQuestionsData.length ? '未检测到已提交作业记录。' : '等待题目数据加载...'
            };
        }
        const isSubmitted = Number(answerRecord.status) === 2;
        if (!isSubmitted) {
            return { state: 'not_submitted', message: '检测到作答记录，但当前任务尚未提交。' };
        }
        const canShowStandardAnswer = paperData?.publish_record?.is_show_answer === true;
        const answersByQuestionId = new Map(answers.map(ans => [String(ans.question_id), ans]));
        const totalScore = toOptionalNumber(paperData?.total_score);
        const actualScore = toOptionalNumber(answerRecord.actual_score ?? answerRecord.score);
        const answerNum = toOptionalNumber(answerRecord.answer_num || globalQuestionsData.length);
        const correctNum = toOptionalNumber(answerRecord.answer_correct_num);
        const questionResults = globalQuestionsData.map(qData => {
            const answer = answersByQuestionId.get(String(qData.id));
            const resultState = getQuestionResultState(answer, qData);
            const score = toOptionalNumber(answer?.score);
            const fullScore = toOptionalNumber(qData.score);
            const scoreText = score !== null
                ? `${score} / ${fullScore !== null ? fullScore : '-'} 分`
                : `- / ${fullScore !== null ? fullScore : '-'} 分`;
            return {
                index: qData.index,
                id: qData.id,
                type: qData.type,
                typeLabel: getQuestionTypeLabel(qData.type),
                title: qData.titleText,
                stateLabel: resultState.label,
                tone: resultState.tone,
                scoreText,
                userAnswer: formatAnswerForDisplay(qData, answer?.answer),
                standardAnswer: getStandardAnswerDisplay(qData, canShowStandardAnswer),
                exportAnswer: getExportAnswerDisplay(qData, answer, canShowStandardAnswer),
                sectionKey: qData.sectionKey
            };
        });
        const resultByQuestionId = new Map(questionResults.map(item => [String(item.id), item]));
        const resultSections = globalQuestionSections.map(section => ({
            key: section.key,
            titleText: section.titleText,
            titleSegments: section.titleSegments,
            isGroup: section.isGroup,
            questionResults: (section.questionIds || [])
                .map(id => resultByQuestionId.get(String(id)))
                .filter(Boolean)
        })).filter(section => section.questionResults.length > 0);
        return {
            state: 'submitted',
            canShowStandardAnswer,
            totalScore,
            actualScore,
            answerNum: answerNum !== null ? answerNum : questionResults.length,
            correctNum,
            questionResults,
            sections: resultSections
        };
    }
    function processPaperData(jsonData) {
        if (!jsonData || !jsonData.data || !jsonData.data.questions) {
            console.warn(`[${SCRIPT_NAME}] 题目数据结构不完整，已跳过处理`);
            return;
        }
        globalPaperId = globalPaperId || jsonData.data.paper_id || jsonData.data.paperId || jsonData.data.id || "";
        if(!globalGroupId) globalGroupId = jsonData.data.group_id;
        if (globalCourseMeta.groupId && globalGroupId && globalCourseMeta.groupId !== globalGroupId) {
            globalCourseMeta = { groupId: globalGroupId, courseName: getCachedCourseName(globalGroupId), loading: false, error: '' };
        }
        if (globalGroupId && !globalCourseMeta.courseName) {
            const cachedCourseName = getCachedCourseName(globalGroupId);
            if (cachedCourseName) globalCourseMeta = { ...globalCourseMeta, groupId: globalGroupId, courseName: cachedCourseName };
        }
        globalPaperMeta = {
            title: String(jsonData.data.title || '课程作业'),
            totalScore: toOptionalNumber(jsonData.data.total_score),
            canShowStandardAnswer: jsonData.data.publish_record?.is_show_answer === true
        };
        globalImageAssets = [];
        globalQuestionSections = [];
        globalPdfQuestions = [];
        const normalized = normalizePaperQuestions(jsonData.data.questions);
        globalQuestionsData = normalized.flattenedQuestions;
        globalQuestionSections = normalized.sections;
        globalPdfQuestions = normalized.pdfQuestions;
        globalExtractedText = buildAiPromptText();
        activeTaskKey = buildTaskKey(globalGroupId, globalNodeId, globalPaperId);
        globalSubmissionResult = buildSubmissionResult(jsonData.data);
        resultPanelVisible = globalSubmissionResult.state === 'submitted';
        resultFilter = 'all';
        imageDrawerVisible = false;
        homeworkDrawerVisible = false;
        fetchCourseInfoForCurrentGroup();
        console.log("✅ 数据清洗完毕，已生成 v1.8 题组结构！");
        createUIPanel();
    }
    function getToken() {
        const cookies = document.cookie.split('; ');
        for (let cookie of cookies) {
            const[name, value] = cookie.split('=');
            if (name.includes('prd-access-token')) return value;
        }
        return null;
    }
    async function fetchRecordId() {
        if (!globalToken) globalToken = getToken();
        if (!globalToken) throw new Error("未获取到 Token");
        if (!globalNodeId || !globalGroupId) throw new Error("未获取到课程或节点参数");
        const url = `${window.location.origin}/api/jx-iresource/survey/course/task/flow/v2?node_id=${globalNodeId}&group_id=${globalGroupId}`;
        const response = await fetch(url, {
            headers: { 'authorization': `Bearer ${globalToken}`, 'content-type': 'application/json' },
            credentials: 'include'
        });
        if (!response.ok) {
            throw new Error(`Record ID 请求失败：${response.status}`);
        }
        const data = await response.json();
        if (data.success && data.data) {
            if (data.data.task_flow_record?.[0]?.answer_record_id) return data.data.task_flow_record[0].answer_record_id;
            if (data.data.task_flow_template?.[0]?.answer_record_id) return data.data.task_flow_template[0].answer_record_id;
        }
        throw new Error("无法获取 Record ID");
    }
    async function submitSingleAnswer(questionId, answerPayload) {
        if (!globalPaperId) throw new Error("未获取到 paper_id");
        const requestBody = {
            record_id: globalRecordId,
            question_id: questionId,
            answer: answerPayload,
            ext_answer: "",
            group_id: globalGroupId,
            paper_id: globalPaperId,
            is_try: 0
        };
        const response = await fetch(`${window.location.origin}/api/jx-iresource/survey/answer`, {
            method: 'POST',
            headers: {
                'accept': '*/*',
                'authorization': `Bearer ${globalToken}`,
                'content-type': 'application/json; charset=UTF-8'
            },
            credentials: 'include',
            body: JSON.stringify(requestBody)
        });
        let responseData = null;
        try {
            responseData = await response.clone().json();
        } catch (e) {
            responseData = null;
        }
        if (!response.ok || responseData?.success === false) {
            const message = responseData?.message || responseData?.error || response.statusText || "未知错误";
            throw new Error(`保存作答失败：${message}`);
        }
        return responseData;
    }
    function parseAIAnswerBlocks(aiText) {
        const blocks = [];
        let current = null;
        String(aiText || '').split(/\r?\n/).forEach(line => {
            const match = line.match(/^\s*(\d+)\s*=>\s*(.*)$/);
            if (match) {
                if (current) {
                    current.answer = current.lines.join('\n').trim();
                    blocks.push(current);
                }
                current = {
                    index: parseInt(match[1], 10),
                    lines: [match[2].trim()]
                };
                return;
            }
            if (current) current.lines.push(line.trimEnd());
        });
        if (current) {
            current.answer = current.lines.join('\n').trim();
            blocks.push(current);
        }
        return blocks.filter(block => Number.isFinite(block.index) && block.answer);
    }
    function createRichTextAnswer(text, questionId) {
        const lines = String(text || '').trim().split(/\r?\n/);
        return JSON.stringify({
            blocks: lines.map((line, index) => ({
                key: `ans-${index}`,
                text: line,
                type: 'unstyled',
                depth: 0,
                inlineStyleRanges: [],
                entityRanges: [],
                data: {}
            })),
            entityMap: {}
        });
    }
    function createMatchingAnswerPayload(qData, answerText) {
        const leftByLetter = new Map((qData.matchingLeftItems || []).map(item => [String(item.letter).toUpperCase(), item]));
        const rightByLetter = new Map((qData.matchingRightItems || []).map(item => [String(item.letter).toLowerCase(), item]));
        const payload = {};
        const segments = String(answerText || '').split(/[|｜;\n；]+/).map(item => item.trim()).filter(Boolean);
        segments.forEach(segment => {
            const match = segment.match(/^\s*([A-Za-z])\s*(?:=>|->|[:：=])\s*(.+?)\s*$/);
            if (!match) {
                console.warn(`[${SCRIPT_NAME}] 匹配题答案片段无法识别：${segment}`);
                return;
            }
            const leftLetter = match[1].toUpperCase();
            const leftItem = leftByLetter.get(leftLetter);
            if (!leftItem) {
                console.warn(`[${SCRIPT_NAME}] 匹配题左侧字母无效：${leftLetter}`);
                return;
            }
            const rightIds = match[2]
                .split(/[,，、\s]+/)
                .map(token => token.trim().replace(/[.。]/g, '').toLowerCase())
                .filter(Boolean)
                .map(letter => {
                    const rightItem = rightByLetter.get(letter);
                    if (!rightItem) {
                        console.warn(`[${SCRIPT_NAME}] 匹配题右侧字母无效：${letter}`);
                        return null;
                    }
                    return rightItem.id;
                })
                .filter(Boolean);
            if (rightIds.length > 0) {
                payload[leftItem.id] = rightIds.join(',');
            }
        });
        return payload;
    }
    async function executeFill(aiText) {
        try {
            globalRecordId = await fetchRecordId();
            console.log("✅ 成功获取 Record ID: ", globalRecordId);
        } catch (e) {
            alert("初始化提交参数失败，请刷新页面重试！\n" + e.message);
            return;
        }
        const answerBlocks = parseAIAnswerBlocks(aiText);
        let successCount = 0;
        let failureCount = 0;
        for (let answerBlock of answerBlocks) {
            let qIndex = answerBlock.index;
            let qAnswerStr = answerBlock.answer.trim();
            let qData = globalQuestionsData.find(q => q.index === qIndex);
            if (!qData) continue;
            if (qData.type === 7) continue;
            let answerPayload =[];
            if (qData.type === 1 || qData.type === 2 || qData.type === 5) {
                let letters = qAnswerStr
                    .split(/[,，、\s]+/)
                    .map(s => s.trim().toUpperCase())
                    .filter(Boolean);
                letters.forEach(letter => {
                    let targetIndex = letter.charCodeAt(0) - 65;
                    if (qData.sortedItems[targetIndex]) {
                        answerPayload.push(qData.sortedItems[targetIndex].id);
                    }
                });
            }
            else if (qData.type === 4) {
                let blanks = qAnswerStr.split(/[|｜]/).map(s => s.trim());
                let fillObject = {};
                qData.sortedItems.forEach((item, idx) => {
                    if (blanks[idx]) {
                        fillObject[item.id] = blanks[idx];
                    }
                });
                answerPayload = [fillObject];
            }
            else if (qData.type === 6 && qAnswerStr) {
                answerPayload = [createRichTextAnswer(qAnswerStr, qData.id)];
            }
            else if (qData.type === 13) {
                const matchObject = createMatchingAnswerPayload(qData, qAnswerStr);
                if (Object.keys(matchObject).length > 0) {
                    answerPayload = [matchObject];
                }
            }
            if (answerPayload.length > 0) {
                try {
                    await submitSingleAnswer(qData.id, answerPayload);
                    successCount++;
                    console.log(`[${SCRIPT_NAME}] 第 ${qIndex} 题作答已保存，Payload:`, answerPayload);
                } catch (error) {
                    failureCount++;
                    console.error(`[${SCRIPT_NAME}] 第 ${qIndex} 题保存失败`, error);
                }
            }
        }
        if (successCount > 0) {
            alert(`${SCRIPT_NAME} 已完成：成功保存 ${successCount} 道题，失败 ${failureCount} 道。点击确定后刷新页面查看结果。`);
            window.location.reload();
        } else {
            alert(`${SCRIPT_NAME} 未保存任何答案，请检查 AI 输出格式或控制台错误。`);
        }
    }
    function setUIStatus(message, isError = false) {
        const status = document.getElementById('xy-status');
        if (status) {
            status.innerText = message;
            status.style.color = isError ? '#dc2626' : '#6b7280';
        }
        const floatingStatus = document.getElementById('xy-floating-status');
        if (floatingStatus) {
            floatingStatus.innerText = globalQuestionsData.length > 0 ? `${globalQuestionsData.length} 道题已同步` : '等待同步题目';
        }
    }
    function safeLocalStorageGet(key) {
        try {
            return localStorage.getItem(key);
        } catch (error) {
            console.warn(`[${SCRIPT_NAME}] localStorage 读取失败：${key}`, error);
            return null;
        }
    }
    function safeLocalStorageSet(key, value) {
        try {
            localStorage.setItem(key, value);
            return true;
        } catch (error) {
            console.warn(`[${SCRIPT_NAME}] localStorage 写入失败：${key}`, error);
            return false;
        }
    }
    function readHomeworkExportOptions() {
        const fallback = { headerMode: 'course_homework', includeAnswers: false, answerPosition: 'inline' };
        const raw = safeLocalStorageGet(HOMEWORK_EXPORT_OPTIONS_KEY);
        if (!raw) return fallback;
        try {
            const parsed = JSON.parse(raw);
            return {
                headerMode: ['course_homework', 'course', 'homework', 'none'].includes(parsed?.headerMode) ? parsed.headerMode : fallback.headerMode,
                includeAnswers: parsed?.includeAnswers === true,
                answerPosition: ['inline', 'appendix'].includes(parsed?.answerPosition) ? parsed.answerPosition : fallback.answerPosition
            };
        } catch (error) {
            console.warn(`[${SCRIPT_NAME}] 作业导出设置解析失败`, error);
            return fallback;
        }
    }
    function saveHomeworkExportOptions() {
        safeLocalStorageSet(HOMEWORK_EXPORT_OPTIONS_KEY, JSON.stringify(homeworkExportOptions));
    }
    function getCourseNameCacheKey(groupId = globalGroupId) {
        return groupId ? `${COURSE_NAME_CACHE_PREFIX}${groupId}` : '';
    }
    function getCachedCourseName(groupId = globalGroupId) {
        const key = getCourseNameCacheKey(groupId);
        return key ? (safeLocalStorageGet(key) || '').trim() : '';
    }
    function cacheCourseName(courseName, groupId = globalGroupId) {
        const key = getCourseNameCacheKey(groupId);
        const value = String(courseName || '').trim();
        if (key && value) safeLocalStorageSet(key, value);
    }
    function getCurrentCourseName() {
        return String(globalCourseMeta.courseName || getCachedCourseName() || '').trim();
    }
    function applyCourseInfo(record, source = 'unknown') {
        const courseName = String(record?.name || record?.course_name || record?.courseName || record?.group_name || record?.groupName || '').trim();
        const groupId = String(record?.id || record?.group_id || globalGroupId || '').trim();
        if (groupId) globalGroupId = globalGroupId || groupId;
        if (!courseName) return;
        globalCourseMeta = {
            ...globalCourseMeta,
            groupId: groupId || globalGroupId,
            courseName,
            loading: false,
            error: ''
        };
        cacheCourseName(courseName, groupId || globalGroupId);
        globalExtractedText = buildAiPromptText();
        updateHomeworkDrawerUI();
        updateUIPanelData();
        console.log(`[${SCRIPT_NAME}] 已更新课程信息：${courseName} (${source})`);
    }
    async function fetchCourseInfoForCurrentGroup() {
        if (!globalGroupId) return;
        const cached = getCachedCourseName();
        if (cached && !globalCourseMeta.courseName) {
            globalCourseMeta = { ...globalCourseMeta, groupId: globalGroupId, courseName: cached, error: '' };
        }
        if (globalCourseMeta.loading || (globalCourseMeta.groupId === globalGroupId && globalCourseMeta.courseName && !globalCourseMeta.error)) {
            updateHomeworkDrawerUI();
            return;
        }
        if (!globalToken) globalToken = getToken();
        globalCourseMeta = { ...globalCourseMeta, groupId: globalGroupId, loading: true, error: '' };
        updateHomeworkDrawerUI();
        try {
            const response = await originalFetch.call(window, `${window.location.origin}/api/jx-iresource/group/queryGroup/${encodeURIComponent(globalGroupId)}`, {
                headers: {
                    'authorization': globalToken ? `Bearer ${globalToken}` : '',
                    'content-type': 'application/json'
                },
                credentials: 'include'
            });
            if (!response.ok) throw new Error(`课程信息请求失败：${response.status}`);
            const data = await response.json();
            if (!data?.success || !data.data) throw new Error(data?.message || '课程信息为空');
            applyCourseInfo(data.data, 'fetch');
        } catch (error) {
            globalCourseMeta = { ...globalCourseMeta, loading: false, error: error?.message || String(error) };
            updateHomeworkDrawerUI();
            console.warn(`[${SCRIPT_NAME}] 课程信息读取失败`, error);
        }
    }
    function isNewerVersion(latest, current) {
        if (!latest) return false;
        const latestParts = String(latest).split('.').map(part => Number(part) || 0);
        const currentParts = String(current).split('.').map(part => Number(part) || 0);
        const length = Math.max(latestParts.length, currentParts.length);
        for (let index = 0; index < length; index++) {
            const latestPart = latestParts[index] || 0;
            const currentPart = currentParts[index] || 0;
            if (latestPart > currentPart) return true;
            if (latestPart < currentPart) return false;
        }
        return false;
    }
    function getNoticeFingerprint(record = noticeState) {
        return [record.version || '', record.updatedAt || '', record.content || ''].join('|');
    }
    function readNoticeCache() {
        const cached = safeLocalStorageGet(NOTICE_CACHE_KEY);
        if (!cached) return null;
        try {
            const parsed = JSON.parse(cached);
            if (!parsed || typeof parsed !== 'object') return null;
            return {
                content: String(parsed.content || '暂无公告'),
                version: String(parsed.version || ''),
                updatedAt: String(parsed.updatedAt || ''),
                fetchedAt: Number(parsed.fetchedAt) || 0
            };
        } catch (error) {
            console.warn(`[${SCRIPT_NAME}] 公告缓存解析失败`, error);
            return null;
        }
    }
    function applyNoticeRecord(record, options = {}) {
        const normalized = {
            content: String(record?.content || '暂无公告'),
            version: String(record?.version || ''),
            updatedAt: String(record?.updatedAt || ''),
            fetchedAt: Number(record?.fetchedAt) || Date.now()
        };
        const readFingerprint = safeLocalStorageGet(NOTICE_READ_KEY) || '';
        noticeState = {
            ...noticeState,
            ...normalized,
            loading: false,
            error: options.error || '',
            hasUnread: options.preventUnread
                ? false
                : normalized.content !== '暂无公告'
                    && !!getNoticeFingerprint(normalized)
                    && getNoticeFingerprint(normalized) !== readFingerprint
        };
        updateNoticeUI();
    }
    function updateNoticeUI() {
        const dot = document.querySelector('.xy-floating-dot');
        if (dot) dot.classList.toggle('xy-notice-unread', noticeState.hasUnread);
        const body = document.getElementById('xy-notice-body');
        if (body) body.textContent = noticeState.content || '暂无公告';
        const meta = document.getElementById('xy-notice-meta');
        if (meta) {
            const timeText = noticeState.updatedAt
                ? new Date(noticeState.updatedAt).toLocaleString()
                : '暂无更新时间';
            meta.textContent = noticeState.error ? `${noticeState.error} · ${timeText}` : timeText;
        }
        const versionBadge = document.getElementById('xy-notice-version-badge');
        if (versionBadge) {
            const showVersion = isNewerVersion(noticeState.version, SCRIPT_VERSION);
            versionBadge.style.display = showVersion ? 'inline-flex' : 'none';
            versionBadge.textContent = showVersion ? `v${noticeState.version} 可用` : '';
        }
        const toggle = document.getElementById('xy-notice-toggle');
        if (toggle) {
            const needsToggle = (noticeState.content || '').length > 70 || (noticeState.content || '').includes('\n');
            toggle.style.display = needsToggle ? 'inline-flex' : 'none';
        }
        const refresh = document.getElementById('xy-notice-refresh');
        if (refresh) {
            refresh.disabled = noticeState.loading;
            refresh.title = noticeState.loading ? '公告刷新中...' : '刷新公告';
            refresh.innerHTML = renderIconSvg('refresh', 12);
        }
    }
    function fetchNoticeWithGM() {
        return new Promise((resolve, reject) => {
            if (typeof GM_xmlhttpRequest !== 'function') {
                reject(new Error('GM_xmlhttpRequest 不可用'));
                return;
            }
            GM_xmlhttpRequest({
                method: 'POST',
                url: NOTICE_API,
                data: JSON.stringify({ action: 'get_notice', channel: NOTICE_CHANNEL, client: `xiaoya-zhanzhanzhan-v${SCRIPT_VERSION}` }),
                headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
                timeout: 10000,
                onload: response => {
                    if (response.status < 200 || response.status >= 300) {
                        reject(new Error(`公告请求失败：${response.status}`));
                        return;
                    }
                    try {
                        resolve(JSON.parse(response.responseText));
                    } catch (error) {
                        reject(new Error('公告响应解析失败'));
                    }
                },
                onerror: () => reject(new Error('公告网络请求失败')),
                ontimeout: () => reject(new Error('公告网络请求超时'))
            });
        });
    }
    async function fetchNoticeRecord() {
        try {
            const response = await fetch(NOTICE_API, {
                method: 'POST',
                body: JSON.stringify({ action: 'get_notice', channel: NOTICE_CHANNEL, client: `xiaoya-zhanzhanzhan-v${SCRIPT_VERSION}` })
            });
            if (!response.ok) throw new Error(`公告请求失败：${response.status}`);
            return await response.json();
        } catch (error) {
            console.warn(`[${SCRIPT_NAME}] 页面 fetch 获取公告失败，尝试 GM_xmlhttpRequest`, error);
            return fetchNoticeWithGM();
        }
    }
    async function runNoticeCheck(forceRefresh = false) {
        const cached = readNoticeCache();
        if (cached) applyNoticeRecord(cached);
        if (!forceRefresh && cached && Date.now() - cached.fetchedAt < NOTICE_CACHE_TTL) return;
        noticeState.loading = true;
        updateNoticeUI();
        try {
            const data = await fetchNoticeRecord();
            if (!data || data.ok !== true) throw new Error('公告返回数据异常');
            if (Number(data.apiVersion) < 2 || data.channel !== NOTICE_CHANNEL) {
                throw new Error('公告服务尚未完成多频道升级');
            }
            const record = {
                content: String(data.content || '暂无公告'),
                version: String(data.version || ''),
                updatedAt: String(data.updatedAt || ''),
                fetchedAt: Date.now()
            };
            safeLocalStorageSet(NOTICE_CACHE_KEY, JSON.stringify(record));
            applyNoticeRecord(record);
        } catch (error) {
            console.warn(`[${SCRIPT_NAME}] 公告加载失败`, error);
            if (cached) {
                applyNoticeRecord(cached, { error: '公告刷新失败，正在显示缓存' });
            } else {
                applyNoticeRecord({
                    content: '公告加载失败',
                    version: '',
                    updatedAt: '',
                    fetchedAt: Date.now()
                }, { error: '公告加载失败', preventUnread: true });
            }
        }
    }
    function markNoticeAsRead() {
        if (!noticeState.hasUnread) return;
        safeLocalStorageSet(NOTICE_READ_KEY, getNoticeFingerprint());
        noticeState.hasUnread = false;
        updateNoticeUI();
    }
    function toggleNoticeBody() {
        const body = document.getElementById('xy-notice-body');
        const toggle = document.getElementById('xy-notice-toggle');
        if (!body || !toggle) return;
        const expanded = body.classList.toggle('xy-notice-expanded');
        toggle.textContent = expanded ? '收起' : '展开';
    }
    function initializeNoticeSystem() {
        const cached = readNoticeCache();
        if (cached) applyNoticeRecord(cached);
        runNoticeCheck(false);
    }
    function getImageAssetLabel(asset) {
        if (asset.source === 'option' && asset.optionLetter) {
            return `第 ${asset.questionIndex} 题选项 ${asset.optionLetter} 图片`;
        }
        return `第 ${asset.questionIndex} 题题干图片`;
    }
    async function fetchImageBlobWithPageFetch(src) {
        const response = await fetch(src, { credentials: 'include', redirect: 'follow' });
        if (!response.ok) throw new Error(`图片请求失败：${response.status}`);
        return response.blob();
    }
    function fetchImageBlobWithGM(src) {
        return new Promise((resolve, reject) => {
            if (typeof GM_xmlhttpRequest !== 'function') {
                reject(new Error('GM_xmlhttpRequest 不可用'));
                return;
            }
            GM_xmlhttpRequest({
                method: 'GET',
                url: src,
                responseType: 'blob',
                withCredentials: true,
                timeout: 15000,
                onload: response => {
                    if (response.status >= 200 && response.status < 300 && response.response) {
                        resolve(response.response);
                    } else {
                        reject(new Error(`GM 图片请求失败：${response.status}`));
                    }
                },
                onerror: () => reject(new Error('GM 图片请求失败')),
                ontimeout: () => reject(new Error('GM 图片请求超时'))
            });
        });
    }
    async function getImageBlob(src) {
        try {
            return await fetchImageBlobWithPageFetch(src);
        } catch (fetchError) {
            console.warn(`[${SCRIPT_NAME}] 页面 fetch 获取图片失败，尝试 GM_xmlhttpRequest`, fetchError);
            return fetchImageBlobWithGM(src);
        }
    }
    async function mapLimit(list, limit, worker) {
        const results = new Array(list.length);
        let cursor = 0;
        const runners = Array.from({ length: Math.min(limit, list.length) }, async () => {
            while (cursor < list.length) {
                const currentIndex = cursor++;
                results[currentIndex] = await worker(list[currentIndex], currentIndex);
            }
        });
        await Promise.all(runners);
        return results;
    }
    function blobToDataUrl(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(new Error('图片编码失败'));
            reader.readAsDataURL(blob);
        });
    }
    async function hydratePdfImages(assets) {
        const uniqueSrcs = Array.from(new Set((assets || []).map(asset => asset.src).filter(Boolean)));
        if (uniqueSrcs.length === 0) return new Map();
        const results = await mapLimit(uniqueSrcs, 3, async src => {
            try {
                const blob = await getImageBlob(src);
                const dataUrl = await blobToDataUrl(blob);
                return { src, ok: true, dataUrl };
            } catch (error) {
                console.warn(`[${SCRIPT_NAME}] PDF 图片读取失败`, error);
                return { src, ok: false, error: error?.message || String(error) };
            }
        });
        const imageMap = new Map();
        results.forEach(result => imageMap.set(result.src, result));
        return imageMap;
    }
    function getPdfFileName() {
        const now = new Date();
        const pad = value => String(value).padStart(2, '0');
        const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
        return `${SCRIPT_NAME}_AI图文题目_${stamp}.pdf`;
    }
    function getTimestamp() {
        const now = new Date();
        const pad = value => String(value).padStart(2, '0');
        return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    }
    function sanitizeFileNamePart(value) {
        return String(value || '课程作业').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || '课程作业';
    }
    function getHomeworkBaseName() {
        return sanitizeFileNamePart(globalPaperMeta.title || '课程作业') + `_${getTimestamp()}`;
    }
    function downloadBlobFile(fileName, content, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        setTimeout(() => {
            URL.revokeObjectURL(url);
            link.remove();
        }, 1000);
    }
    function segmentsToPlainText(segments) {
        return (segments || []).map(segment => {
            if (segment.type === 'image') return '[图片]';
            if (segment.type === 'formula') return `[公式: ${segment.value || ''}]`;
            return segment.value || '';
        }).filter(Boolean).join('\n').trim();
    }
    function renderPrintSegments(segments, imageMap) {
        if (!segments || segments.length === 0) {
            return '<div class="xy-print-empty">[内容为空]</div>';
        }
        return segments.map(segment => {
            if (segment.type === 'image') {
                const imageRecord = imageMap.get(segment.src);
                if (!imageRecord || !imageRecord.ok || !imageRecord.dataUrl) {
                    return '<div class="xy-print-image-failed">[图片读取失败]</div>';
                }
                return `
                    <figure class="xy-print-image">
                        <figcaption>[图片]</figcaption>
                        <img src="${escapeHTML(imageRecord.dataUrl)}" alt="题目图片">
                    </figure>
                `;
            }
            if (segment.type === 'formula') {
                return `<div class="xy-print-rich-text">[公式: ${escapeHTML(segment.value || '')}]</div>`;
            }
            return `<div class="xy-print-rich-text">${escapeHTML(segment.value || '')}</div>`;
        }).join('');
    }
    function renderPrintQuestion(question, imageMap, answerText = '') {
        let detailHtml = '';
        if (question.options && question.options.length > 0) {
            detailHtml = `
                <div class="xy-print-options">
                    ${question.options.map(option => `
                        <div class="xy-print-option">
                            <div class="xy-print-option-letter">${escapeHTML(option.letter)}.</div>
                            <div>${renderPrintSegments(option.segments, imageMap)}</div>
                        </div>
                    `).join('')}
                </div>
            `;
        } else if (question.type === 4) {
            detailHtml = `<div class="xy-print-note">(本题共 ${escapeHTML(question.blankCount)} 个填空)</div>`;
        } else if (question.type === 7) {
            detailHtml = '<div class="xy-print-note xy-print-warning">附件题无需回答。</div>';
        } else if (question.type === 13) {
            detailHtml = `
                <div class="xy-print-match">
                    <div class="xy-print-match-heading">左侧：</div>
                    ${(question.matchingLeftItems || []).map(item => `
                        <div class="xy-print-option">
                            <div class="xy-print-option-letter">${escapeHTML(item.letter)}.</div>
                            <div>${renderPrintSegments(item.segments, imageMap)}</div>
                        </div>
                    `).join('')}
                    <div class="xy-print-match-heading">右侧候选：</div>
                    ${(question.matchingRightItems || []).map(item => `
                        <div class="xy-print-option">
                            <div class="xy-print-option-letter">${escapeHTML(item.letter)}.</div>
                            <div>${renderPrintSegments(item.segments, imageMap)}</div>
                        </div>
                    `).join('')}
                </div>
            `;
        }
        const answerHtml = answerText
            ? `<div class="xy-print-answer"><strong>答案：</strong>${escapeHTML(answerText)}</div>`
            : '';
        return `
            <section class="xy-print-question">
                <h3>${escapeHTML(question.index)}. ${escapeHTML(question.typeLabel)}</h3>
                <div class="xy-print-title">${renderPrintSegments(question.titleSegments, imageMap)}</div>
                ${detailHtml}
                ${answerHtml}
            </section>
        `;
    }
    function getPdfQuestionMap() {
        return new Map(globalPdfQuestions.map(question => [String(question.id), question]));
    }
    function getHomeworkAnswerMap() {
        const answers = new Map();
        if (!homeworkExportOptions.includeAnswers) return answers;
        const resultById = new Map((globalSubmissionResult?.questionResults || []).map(item => [String(item.id), item]));
        globalQuestionsData.forEach(qData => {
            const standardAnswer = getStandardAnswerDisplay(qData, globalPaperMeta.canShowStandardAnswer === true);
            const fallbackAnswer = resultById.get(String(qData.id))?.exportAnswer || '';
            const answer = standardAnswer || fallbackAnswer;
            if (answer) answers.set(String(qData.id), answer);
        });
        return answers;
    }
    function renderPrintSection(section, imageMap, answerMap = new Map(), options = {}) {
        const pdfById = getPdfQuestionMap();
        const questionsHtml = (section.questionIds || [])
            .map(id => pdfById.get(String(id)))
            .filter(Boolean)
            .map(question => {
                const answer = options.answerPosition === 'inline' ? answerMap.get(String(question.id)) || '' : '';
                return renderPrintQuestion(question, imageMap, answer);
            }).join('');
        const sectionHeader = section.isGroup && section.titleSegments?.length
            ? `<section class="xy-print-section"><h2>${escapeHTML(section.titleText || '题组')}</h2><div class="xy-print-section-body">${renderPrintSegments(section.titleSegments, imageMap)}</div></section>`
            : '';
        return `${sectionHeader}${questionsHtml}`;
    }
    function renderAnswersAppendix(answerMap) {
        if (!answerMap || answerMap.size === 0 || homeworkExportOptions.answerPosition !== 'appendix') return '';
        const lines = globalQuestionsData
            .map(question => {
                const answer = answerMap.get(String(question.id));
                return answer ? `<div class="xy-print-answer-line"><strong>${escapeHTML(question.index)}.</strong> ${escapeHTML(answer)}</div>` : '';
            })
            .filter(Boolean)
            .join('');
        return lines ? `<section class="xy-print-appendix"><h2>答案</h2>${lines}</section>` : '';
    }
    function renderDocumentSections(imageMap, answerMap = new Map(), options = {}) {
        return globalQuestionSections.length
            ? globalQuestionSections.map(section => renderPrintSection(section, imageMap, answerMap, options)).join('')
            : '<div class="xy-print-empty">未读取到题目数据。</div>';
    }
    function buildDocumentHeaderHtml(mode) {
        if (mode === 'ai') {
            const courseName = getCurrentCourseName();
            const courseMeta = courseName ? `<div class="xy-print-subtitle">课程：${escapeHTML(courseName)}</div>` : '';
            return `
    <header>
        <h1>${escapeHTML(SCRIPT_NAME)} AI 图文题目</h1>
        ${courseMeta}
        <div class="xy-print-subtitle">浏览器原生打印版：题目文字可选中、可复制、可搜索。</div>
        <div class="xy-print-save-tip">${escapeHTML(PDF_SAVE_TIP)}</div>
        <div class="xy-print-rules">
            请根据以下题目作答，严格按指定格式返回答案，不要输出解析、注释或额外说明。<br>
            单选/判断：1 =&gt; A　　多选：2 =&gt; A,C　　填空：3 =&gt; const | let<br>
            简答：21 =&gt; 完整文字答案　　匹配：10 =&gt; A:a,d | B:b,c　　附件题无需回答
        </div>
    </header>`;
        }
        const courseName = getCurrentCourseName();
        const title = globalPaperMeta.title || '课程作业';
        if (homeworkExportOptions.headerMode === 'none') return '';
        if (homeworkExportOptions.headerMode === 'course') {
            return courseName ? `<header><h1>课程：${escapeHTML(courseName)}</h1></header>` : '';
        }
        if (homeworkExportOptions.headerMode === 'homework') {
            return `<header><h1>${escapeHTML(title)}</h1></header>`;
        }
        const meta = courseName ? `<div class="xy-print-subtitle">课程：${escapeHTML(courseName)}</div>` : '';
        return `<header><h1>${escapeHTML(title)}</h1>${meta}</header>`;
    }
    function buildPrintDocumentHtml(imageMap, title, options = {}) {
        const mode = options.mode || 'ai';
        const answerMap = mode === 'homework' ? getHomeworkAnswerMap() : new Map();
        const questionsHtml = renderDocumentSections(imageMap, answerMap, {
            answerPosition: mode === 'homework' ? homeworkExportOptions.answerPosition : 'inline'
        });
        const appendixHtml = mode === 'homework' ? renderAnswersAppendix(answerMap) : '';
        const headerHtml = buildDocumentHeaderHtml(mode);
        const printScript = options.autoPrint ? `
    <script>
        window.addEventListener('load', function() {
            var images = Array.from(document.images);
            Promise.all(images.map(function(image) {
                if (image.complete) return Promise.resolve();
                return new Promise(function(resolve) {
                    image.addEventListener('load', resolve, { once: true });
                    image.addEventListener('error', resolve, { once: true });
                });
            })).then(function() {
                setTimeout(function() {
                    window.focus();
                    window.print();
                }, 250);
            });
        });
    <\/script>` : '';
        return `<!doctype html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <title>${escapeHTML(title)}</title>
    <style>
        @page { size: A4 portrait; margin: 16mm 15mm 16mm; }
        * { box-sizing: border-box; }
        body { margin: 0; color: #111827; font: 14px/1.7 Arial, "Microsoft YaHei", sans-serif; }
        h1 { margin: 0; color: #1f2937; font-size: 22px; line-height: 1.35; }
        h2 { margin: 0 0 7px; color: #111827; font-size: 16px; line-height: 1.45; }
        h3 { margin: 0 0 7px; color: #111827; font-size: 15px; line-height: 1.45; }
        .xy-print-subtitle { margin-top: 4px; color: #6b7280; font-size: 11px; }
        .xy-print-save-tip { margin-top: 10px; padding: 9px 11px; border: 1px solid #bfdbfe; background: #eff6ff; color: #1d4ed8; font-size: 12px; font-weight: 700; line-height: 1.5; }
        .xy-print-rules { margin-top: 13px; padding: 9px 11px; border: 1px solid #e5e7eb; background: #f9fafb; color: #4b5563; font-size: 11px; line-height: 1.65; }
        .xy-print-section { padding: 16px 0 8px; border-bottom: 1px solid #d1d5db; break-inside: avoid-page; page-break-inside: avoid; }
        .xy-print-section-body { white-space: pre-wrap; overflow-wrap: anywhere; }
        .xy-print-question { padding: 13px 0 14px; border-bottom: 1px solid #e5e7eb; break-inside: avoid-page; page-break-inside: avoid; }
        .xy-print-title { font-weight: 600; }
        .xy-print-rich-text { min-height: 1px; white-space: pre-wrap; overflow-wrap: anywhere; }
        .xy-print-options, .xy-print-match { margin-top: 6px; }
        .xy-print-option { display: grid; grid-template-columns: 22px minmax(0, 1fr); gap: 2px; margin-top: 4px; padding-left: 12px; break-inside: avoid-page; page-break-inside: avoid; }
        .xy-print-option-letter, .xy-print-match-heading { font-weight: 700; }
        .xy-print-match-heading { margin: 8px 0 2px 12px; color: #374151; }
        .xy-print-note { margin-top: 6px; padding-left: 12px; color: #4b5563; }
        .xy-print-warning { color: #b45309; }
        .xy-print-empty { color: #9ca3af; }
        .xy-print-image { margin: 7px 0 8px; break-inside: avoid-page; page-break-inside: avoid; }
        .xy-print-image figcaption { margin-bottom: 4px; color: #6b7280; font-size: 11px; font-weight: 700; }
        .xy-print-image img { display: block; max-width: 100%; max-height: 88mm; object-fit: contain; }
        .xy-print-image-failed { margin: 7px 0; padding: 15px; border: 1px dashed #d1d5db; background: #f3f4f6; color: #6b7280; font-weight: 700; }
        .xy-print-answer { margin-top: 8px; padding: 8px 10px; border-left: 3px solid #111827; background: #f9fafb; white-space: pre-wrap; overflow-wrap: anywhere; }
        .xy-print-appendix { padding-top: 18px; break-before: page; page-break-before: always; }
        .xy-print-answer-line { margin-top: 7px; white-space: pre-wrap; overflow-wrap: anywhere; }
        @media print { .xy-print-save-tip { display: none; } }
    </style>
</head>
<body>
    ${headerHtml}
    <main>${questionsHtml}</main>
    ${appendixHtml}
    ${printScript}
</body>
</html>`;
    }
    function writePrintWindowLoading(printWindow, title) {
        printWindow.document.open();
        printWindow.document.write(`<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><title>${escapeHTML(title)}</title></head><body style="margin:0;padding:32px;font:15px/1.7 Arial,'Microsoft YaHei',sans-serif;color:#374151;"><strong>正在生成导出文档...</strong><div style="margin-top:8px;color:#6b7280;">正在下载题目图片，请稍候。</div></body></html>`);
        printWindow.document.close();
    }
    function writePrintWindowFailure(printWindow, message) {
        printWindow.document.open();
        printWindow.document.write(`<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><title>PDF 导出失败</title></head><body style="margin:0;padding:32px;font:15px/1.7 Arial,'Microsoft YaHei',sans-serif;color:#991b1b;"><strong>PDF 导出失败</strong><div style="margin-top:8px;">${escapeHTML(message)}</div></body></html>`);
        printWindow.document.close();
    }
    async function exportPaperAsPdf() {
        if (!globalPdfQuestions.length) {
            setUIStatus('还没有读取到题目数据，无法导出 PDF。', true);
            return;
        }
        const fileName = getPdfFileName();
        const printWindow = window.open('', '_blank');
        if (!printWindow) {
            setUIStatus('打印窗口被浏览器拦截，请允许此页面打开新窗口后重试。', true);
            return;
        }
        writePrintWindowLoading(printWindow, fileName);
        setUIStatus('正在下载题目图片...');
        try {
            const imageMap = await hydratePdfImages(globalImageAssets);
            setUIStatus('正在生成 AI 图文 PDF...');
            printWindow.document.open();
            printWindow.document.write(buildPrintDocumentHtml(imageMap, fileName, { mode: 'ai', autoPrint: true }));
            printWindow.document.close();
            const failedCount = Array.from(imageMap.values()).filter(item => !item.ok).length;
            setUIStatus(
                failedCount > 0
                    ? `${PDF_SAVE_TIP}${failedCount} 张图片读取失败。`
                    : PDF_SAVE_TIP,
                failedCount > 0
            );
        } catch (error) {
            writePrintWindowFailure(printWindow, error?.message || String(error));
            throw error;
        }
    }
    function buildHomeworkPlainText() {
        const lines = [];
        const courseName = getCurrentCourseName();
        if (homeworkExportOptions.headerMode === 'course_homework') {
            if (globalPaperMeta.title) lines.push(globalPaperMeta.title);
            if (courseName) lines.push(`课程：${courseName}`);
            if (lines.length) lines.push('');
        } else if (homeworkExportOptions.headerMode === 'course') {
            if (courseName) {
                lines.push(`课程：${courseName}`);
                lines.push('');
            }
        } else if (homeworkExportOptions.headerMode === 'homework') {
            if (globalPaperMeta.title) {
                lines.push(globalPaperMeta.title);
                lines.push('');
            }
        }
        const answerMap = getHomeworkAnswerMap();
        const appendix = [];
        globalQuestionSections.forEach(section => {
            if (section.isGroup && section.titleText) {
                lines.push(section.titleText);
                lines.push('');
            }
            section.questions.forEach(question => {
                lines.push(`${question.index}. ${question.typeLabel}`);
                const title = segmentsToPlainText(question.titleSegments) || question.titleText;
                if (title) lines.push(title);
                if (question.type === 1 || question.type === 2 || question.type === 5) {
                    question.options.forEach(option => lines.push(`${option.letter}. ${option.text}`));
                } else if (question.type === 4) {
                    lines.push(`(本题共 ${question.sortedItems.length} 个填空)`);
                } else if (question.type === 13) {
                    lines.push('左侧：');
                    question.matchingLeftItems.forEach(item => lines.push(`${item.letter}. ${item.text}`));
                    lines.push('右侧候选：');
                    question.matchingRightItems.forEach(item => lines.push(`${item.letter}. ${item.text}`));
                } else if (question.type === 7) {
                    lines.push('本题为附件题。');
                }
                const answer = answerMap.get(String(question.id));
                if (answer && homeworkExportOptions.answerPosition === 'inline') {
                    lines.push(`答案：${answer}`);
                } else if (answer && homeworkExportOptions.answerPosition === 'appendix') {
                    appendix.push(`${question.index}. ${answer}`);
                }
                lines.push('');
            });
        });
        if (appendix.length) {
            lines.push('答案');
            appendix.forEach(line => lines.push(line));
        }
        return lines.join('\n').trim();
    }
    async function buildHomeworkHtmlContent(options = {}) {
        const imageMap = await hydratePdfImages(globalImageAssets);
        return buildPrintDocumentHtml(imageMap, globalPaperMeta.title || '课程作业', {
            mode: 'homework',
            autoPrint: options.autoPrint === true
        });
    }
    async function exportHomeworkAsPdf() {
        if (!globalQuestionsData.length) {
            setUIStatus('还没有读取到题目数据，无法导出作业。', true);
            return;
        }
        const printWindow = window.open('', '_blank');
        if (!printWindow) {
            setUIStatus('打印窗口被浏览器拦截，请允许此页面打开新窗口后重试。', true);
            return;
        }
        writePrintWindowLoading(printWindow, globalPaperMeta.title || '课程作业');
        setUIStatus('正在生成作业 PDF...');
        try {
            const html = await buildHomeworkHtmlContent({ autoPrint: true });
            printWindow.document.open();
            printWindow.document.write(html);
            printWindow.document.close();
            setUIStatus(PDF_SAVE_TIP);
        } catch (error) {
            writePrintWindowFailure(printWindow, error?.message || String(error));
            throw error;
        }
    }
    async function exportHomeworkAsDoc() {
        if (!globalQuestionsData.length) {
            setUIStatus('还没有读取到题目数据，无法导出作业。', true);
            return;
        }
        setUIStatus('正在生成作业 DOC...');
        const html = await buildHomeworkHtmlContent();
        downloadBlobFile(`${getHomeworkBaseName()}.doc`, `\ufeff${html}`, 'application/msword;charset=utf-8');
        setUIStatus('已导出作业 DOC。');
    }
    function copyHomeworkText() {
        if (!globalQuestionsData.length) {
            setUIStatus('还没有读取到题目数据，无法复制作业。', true);
            return;
        }
        const text = buildHomeworkPlainText();
        GM_setClipboard(text, 'text');
        setUIStatus('已复制纯净作业文本。');
    }
    function convertBlobToPng(blob) {
        if (blob.type === 'image/png') return Promise.resolve(blob);
        return new Promise((resolve, reject) => {
            const image = new Image();
            const objectUrl = URL.createObjectURL(blob);
            image.onload = () => {
                try {
                    const canvas = document.createElement('canvas');
                    canvas.width = image.naturalWidth || image.width;
                    canvas.height = image.naturalHeight || image.height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(image, 0, 0);
                    canvas.toBlob(pngBlob => {
                        URL.revokeObjectURL(objectUrl);
                        if (pngBlob) resolve(pngBlob);
                        else reject(new Error('图片转 PNG 失败'));
                    }, 'image/png');
                } catch (error) {
                    URL.revokeObjectURL(objectUrl);
                    reject(error);
                }
            };
            image.onerror = () => {
                URL.revokeObjectURL(objectUrl);
                reject(new Error('图片解码失败'));
            };
            image.src = objectUrl;
        });
    }
    async function copyImageAsset(asset) {
        try {
            if (!navigator.clipboard || typeof navigator.clipboard.write !== 'function' || typeof ClipboardItem === 'undefined') {
                throw new Error('当前浏览器不支持图片剪贴板');
            }
            const blob = await getImageBlob(asset.src);
            const pngBlob = await convertBlobToPng(blob);
            await navigator.clipboard.write([
                new ClipboardItem({ 'image/png': pngBlob })
            ]);
            setUIStatus(`${getImageAssetLabel(asset)} 已复制为图片。`);
        } catch (error) {
            console.warn(`[${SCRIPT_NAME}] 图片复制失败，回退复制链接`, error);
            GM_setClipboard(asset.src, 'text');
            setUIStatus('图片复制失败，已复制图片链接', true);
        }
    }
    function renderImageAssets() {
        const container = document.getElementById('xy-image-list');
        if (!container) return;
        container.innerHTML = '';
        if (globalImageAssets.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'xy-empty-state';
            empty.textContent = '未检测到题目图片。';
            container.appendChild(empty);
            return;
        }
        globalImageAssets.forEach(asset => {
            const item = document.createElement('div');
            item.className = 'xy-image-item';
            const label = document.createElement('div');
            label.textContent = getImageAssetLabel(asset);
            label.className = 'xy-image-label';
            const img = document.createElement('img');
            img.src = asset.src;
            img.alt = getImageAssetLabel(asset);
            img.className = 'xy-image-preview';
            const actions = document.createElement('div');
            actions.className = 'xy-image-actions';
            const copyImageBtn = document.createElement('button');
            copyImageBtn.className = 'xy-mini-btn xy-mini-btn-primary';
            copyImageBtn.innerHTML = `${renderIconSvg('copy', 14)}<span>复制图片</span>`;
            copyImageBtn.onclick = async () => {
                copyImageBtn.disabled = true;
                copyImageBtn.querySelector('span').textContent = '复制中...';
                await copyImageAsset(asset);
                copyImageBtn.disabled = false;
                copyImageBtn.querySelector('span').textContent = '复制图片';
            };
            const copyLinkBtn = document.createElement('button');
            copyLinkBtn.className = 'xy-mini-btn';
            copyLinkBtn.innerHTML = `${renderIconSvg('link', 14)}<span>复制链接</span>`;
            copyLinkBtn.onclick = () => {
                GM_setClipboard(asset.src, 'text');
                setUIStatus(`${getImageAssetLabel(asset)} 链接已复制。`);
            };
            actions.appendChild(copyImageBtn);
            actions.appendChild(copyLinkBtn);
            item.appendChild(label);
            item.appendChild(img);
            item.appendChild(actions);
            container.appendChild(item);
        });
    }
    function escapeHTML(value) {
        return String(value ?? '').replace(/[&<>"']/g, char => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[char]));
    }
    function renderXyLogoSvg(size = 30) {
        return `
            <svg class="xy-logo-svg" width="${size}" height="${size}" viewBox="0 0 1024 1024" aria-hidden="true" focusable="false">
                <polygon fill="#f7f8f8" points="190,170 332,170 455,384 358,508"></polygon>
                <polygon fill="#f7f8f8" points="714,170 854,170 428,792 286,792"></polygon>
                <polygon fill="#62e6b5" points="508,660 812,660 812,792 416,792"></polygon>
            </svg>
        `;
    }
    function renderIconSvg(name, size = 16) {
        const paths = {
            copy: '<rect x="8" y="8" width="11" height="11" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>',
            file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6"></path><path d="M8 13h8"></path><path d="M8 17h6"></path>',
            save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><path d="M17 21v-8H7v8"></path><path d="M7 3v5h8"></path>',
            refresh: '<path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 5v4h4"></path><path d="M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4"></path>',
            results: '<path d="M4 19V5"></path><path d="M10 19V9"></path><path d="M16 19v-6"></path><path d="M22 19V3"></path>',
            chevron: '<path d="m9 18 6-6-6-6"></path>',
            close: '<path d="M18 6 6 18"></path><path d="m6 6 12 12"></path>',
            image: '<rect x="3" y="3" width="18" height="18" rx="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><path d="m21 15-5-5L5 21"></path>',
            link: '<path d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1"></path><path d="M14 11a5 5 0 0 0-7.1-.1l-2 2A5 5 0 0 0 12 20l1.1-1.1"></path>'
        };
        return `<svg class="xy-icon" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths[name] || paths.chevron}</svg>`;
    }
    function injectUIStyles() {
        if (document.getElementById('xy-v18-style')) return;
        const style = document.createElement('style');
        style.id = 'xy-v18-style';
        style.textContent = `
            #xy-magic-box {
                --xy-bg: #f7f8f8;
                --xy-surface: rgba(250, 252, 251, .94);
                --xy-surface-solid: #fbfcfc;
                --xy-graphite: #111315;
                --xy-charcoal: #1b1f21;
                --xy-muted: #737b7a;
                --xy-line: rgba(17, 19, 21, .10);
                --xy-line-strong: rgba(17, 19, 21, .16);
                --xy-mint: #62e6b5;
                --xy-mint-deep: #187a5c;
                --xy-danger: #e45a64;
                --xy-warning: #c18a3b;
                --xy-shadow: 0 26px 70px rgba(16, 24, 24, .18), 0 8px 24px rgba(16, 24, 24, .09);
                color: var(--xy-graphite);
                letter-spacing: 0;
            }
            #xy-magic-box *, #xy-magic-box *::before, #xy-magic-box *::after {
                box-sizing: border-box;
            }
            #xy-floating-trigger {
                position: relative;
                display: flex;
                width: 184px;
                min-height: 54px;
                align-items: center;
                gap: 10px;
                overflow: hidden;
                padding: 7px 13px 7px 9px;
                border: 1px solid rgba(255,255,255,.11);
                border-radius: 18px;
                background: linear-gradient(145deg, #111315 0%, #1b2021 100%);
                box-shadow: 0 20px 44px rgba(9,14,15,.28), inset 0 1px 0 rgba(255,255,255,.10);
                color: #f7f8f8;
                cursor: move;
                isolation: isolate;
                user-select: none;
                transform: scale(1);
                transform-origin: center;
                transition: transform .22s cubic-bezier(.16,1,.3,1), border-radius .24s cubic-bezier(.16,1,.3,1), box-shadow .24s ease, border-color .24s ease, opacity .18s ease;
                will-change: transform;
            }
            #xy-floating-trigger:hover {
                z-index: 2;
                border-radius: 26px;
                border-color: rgba(98,230,181,.36);
                box-shadow: 0 24px 56px rgba(9,14,15,.34), 0 0 0 1px rgba(98,230,181,.11), inset 0 1px 0 rgba(255,255,255,.13);
                transform: scale(1.025);
            }
            #xy-floating-trigger:active {
                border-radius: 26px;
                transform: scale(.995);
                transition-duration: .09s;
            }
            #xy-magic-box[data-dragging="1"] #xy-floating-trigger {
                border-radius: 26px;
                border-color: rgba(98,230,181,.36);
                box-shadow: 0 24px 56px rgba(9,14,15,.34), 0 0 0 1px rgba(98,230,181,.11), inset 0 1px 0 rgba(255,255,255,.13);
                cursor: grabbing;
                transform: scale(1);
                transition: border-radius .16s ease, box-shadow .16s ease, border-color .16s ease, opacity .18s ease;
            }
            #xy-floating-trigger.xy-trigger-hidden {
                display: none;
            }
            .xy-floating-logo {
                display: grid;
                width: 40px;
                height: 40px;
                flex: 0 0 auto;
                place-items: center;
            }
            .xy-logo-svg {
                display: block;
                width: 40px;
                height: 40px;
                filter: drop-shadow(0 7px 10px rgba(0,0,0,.24));
            }
            .xy-floating-copy {
                display: flex;
                min-width: 0;
                flex: 1;
                flex-direction: column;
                align-items: flex-start;
                justify-content: center;
                line-height: 1.15;
            }
            .xy-floating-title {
                color: #f8fbfa;
                font-size: 14px;
                font-weight: 760;
                white-space: nowrap;
            }
            .xy-floating-status-row, .xy-status-inline, .xy-header-meta, .xy-notice-inline {
                display: flex;
                align-items: center;
            }
            .xy-floating-status-row {
                gap: 6px;
                margin-top: 5px;
            }
            .xy-floating-dot, .xy-status-dot {
                width: 6px;
                height: 6px;
                flex: 0 0 auto;
                border-radius: 999px;
                background: var(--xy-mint);
                box-shadow: 0 0 0 3px rgba(98,230,181,.13), 0 0 15px rgba(98,230,181,.44);
            }
            .xy-floating-dot.xy-notice-unread {
                background: var(--xy-danger);
                box-shadow: 0 0 0 3px rgba(228,90,100,.14), 0 0 16px rgba(228,90,100,.52);
            }
            #xy-floating-status {
                overflow: hidden;
                color: rgba(247,248,248,.62);
                font-size: 10.5px;
                font-weight: 650;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .xy-drag-grip {
                width: 5px;
                height: 20px;
                flex: 0 0 auto;
                opacity: .34;
                background: radial-gradient(circle, rgba(247,248,248,.8) 1px, transparent 1.2px) 0 0 / 4px 5px;
            }
            #xy-panel-shell {
                position: relative;
                display: none;
                align-items: flex-start;
                gap: 10px;
                opacity: 0;
                transition: opacity .18s ease;
            }
            #xy-panel-shell.xy-shell-open {
                opacity: 1;
            }
            #xy-panel-shell.xy-shell-closing {
                pointer-events: none;
            }
            .xy-panel-surface {
                position: relative;
                overflow: hidden;
                border: 1px solid rgba(17,19,21,.10);
                border-radius: 13px;
                background: var(--xy-surface);
                box-shadow: var(--xy-shadow);
                backdrop-filter: blur(22px) saturate(1.18);
            }
            #xy-panel {
                width: min(410px, calc(100vw - 16px));
                max-height: min(82vh, 760px);
            }
            #xy-result-panel {
                width: 310px;
                max-height: min(82vh, 760px);
                opacity: 1;
                transition: opacity .16s ease;
            }
            #xy-result-panel.xy-result-fading {
                opacity: 0;
                pointer-events: none;
            }
            #xy-panel-shell.xy-narrow {
                width: min(410px, calc(100vw - 16px)) !important;
            }
            #xy-panel-shell.xy-narrow #xy-result-panel {
                position: absolute;
                z-index: 6;
                top: 0;
                right: 0;
                width: min(310px, calc(100vw - 16px));
            }
            .xy-main-scroll, .xy-result-scroll, .xy-image-drawer, .xy-homework-drawer {
                scrollbar-color: rgba(17,19,21,.18) transparent;
                scrollbar-width: thin;
            }
            .xy-main-scroll {
                max-height: min(82vh, 760px);
                overflow: auto;
                padding: 16px;
            }
            .xy-result-scroll {
                max-height: min(82vh, 760px);
                overflow: auto;
                padding: 15px;
            }
            .xy-panel-header, .xy-result-header, .xy-header-actions, .xy-action-grid,
            .xy-image-actions, .xy-drawer-header, .xy-footer-status, .xy-result-row-top {
                display: flex;
                align-items: center;
            }
            .xy-panel-header, .xy-result-header, .xy-drawer-header {
                justify-content: space-between;
                gap: 10px;
            }
            .xy-panel-header {
                padding-bottom: 13px;
                border-bottom: 1px solid var(--xy-line);
                cursor: move;
                user-select: none;
            }
            .xy-brand {
                display: flex;
                min-width: 0;
                align-items: center;
                gap: 9px;
            }
            .xy-brand-logo {
                display: grid;
                width: 34px;
                height: 34px;
                flex: 0 0 auto;
                place-items: center;
                border-radius: 9px;
                background: var(--xy-graphite);
                box-shadow: inset 0 1px 0 rgba(255,255,255,.10), 0 8px 16px rgba(17,19,21,.16);
            }
            .xy-brand-logo .xy-logo-svg {
                width: 29px;
                height: 29px;
            }
            .xy-title {
                color: var(--xy-graphite);
                font-size: 15px;
                font-weight: 780;
                line-height: 1.2;
            }
            .xy-subtitle, .xy-result-subtitle, .xy-helper, #xy-notice-meta {
                color: var(--xy-muted);
                font-size: 10.5px;
                line-height: 1.45;
            }
            .xy-subtitle {
                margin-top: 4px;
            }
            .xy-header-actions {
                gap: 6px;
            }
            .xy-icon-btn {
                display: grid;
                width: 30px;
                height: 30px;
                place-items: center;
                border: 1px solid var(--xy-line);
                border-radius: 8px;
                background: rgba(255,255,255,.54);
                color: #39413f;
                cursor: pointer;
                transform: scale(1);
                transition: transform .18s cubic-bezier(.2,.8,.2,1), border-radius .18s ease, border-color .2s ease, background .2s ease, color .2s ease, box-shadow .2s ease;
                will-change: transform;
            }
            .xy-icon-btn:hover {
                z-index: 2;
                border-radius: 12px;
                border-color: rgba(98,230,181,.62);
                background: rgba(98,230,181,.11);
                color: #146349;
                box-shadow: 0 8px 16px rgba(31,91,72,.10);
                transform: scale(1.1);
            }
            .xy-icon-btn:active {
                border-radius: 10px;
                transform: scale(.94);
                transition-duration: .08s;
            }
            .xy-icon-btn:disabled {
                opacity: .36;
                cursor: not-allowed;
                transform: none;
            }
            .xy-icon {
                fill: none;
                stroke: currentColor;
                stroke-linecap: round;
                stroke-linejoin: round;
                stroke-width: 1.8;
            }
            .xy-notice-strip {
                margin-top: 12px;
                padding: 8px 9px;
                border: 1px solid rgba(98,230,181,.22);
                border-radius: 8px;
                background: rgba(98,230,181,.055);
            }
            .xy-notice-inline {
                min-width: 0;
                gap: 7px;
            }
            .xy-notice-title {
                flex: 0 0 auto;
                color: #17694f;
                font-size: 11px;
                font-weight: 800;
            }
            #xy-notice-version-badge {
                display: none;
                flex: 0 0 auto;
                padding: 1px 5px;
                border-radius: 999px;
                background: rgba(228,90,100,.12);
                color: #bd3f49;
                font-size: 9px;
                font-weight: 800;
            }
            #xy-notice-body {
                display: -webkit-box;
                min-width: 0;
                flex: 1;
                overflow: hidden;
                color: #4f5957;
                font-size: 11px;
                line-height: 1.55;
                overflow-wrap: anywhere;
                -webkit-box-orient: vertical;
                -webkit-line-clamp: 1;
            }
            #xy-notice-body.xy-notice-expanded {
                display: block;
                margin-top: 7px;
                max-height: 132px;
                overflow: auto;
                white-space: pre-wrap;
            }
            .xy-notice-actions {
                display: flex;
                flex: 0 0 auto;
                gap: 3px;
            }
            .xy-notice-action {
                display: inline-flex;
                align-items: center;
                border: none;
                background: transparent;
                color: #26765d;
                font-size: 10px;
                font-weight: 760;
                cursor: pointer;
                gap: 4px;
                padding: 3px 4px;
                border-radius: 5px;
                transform: scale(1);
                transition: transform .18s cubic-bezier(.2,.8,.2,1), border-radius .18s ease, background .18s ease, color .18s ease;
                will-change: transform;
            }
            .xy-notice-action:hover {
                border-radius: 9px;
                background: rgba(98,230,181,.12);
                color: #17694f;
                transform: scale(1.055);
            }
            .xy-notice-action:active {
                border-radius: 7px;
                transform: scale(.96);
                transition-duration: .08s;
            }
            .xy-notice-action:disabled {
                opacity: .42;
                cursor: wait;
                transform: none;
            }
            #xy-notice-meta {
                margin-top: 5px;
            }
            .xy-id-note {
                margin-top: 10px;
                color: #64706e;
                font-size: 10.5px;
                line-height: 1.55;
            }
            .xy-action-grid {
                display: grid;
                grid-template-columns: repeat(2, minmax(0, 1fr));
                gap: 8px;
                margin-top: 13px;
            }
            .xy-homework-entry-btn {
                width: 100%;
                margin-top: 9px;
            }
            .xy-action-btn {
                display: inline-flex;
                min-width: 0;
                flex: 1;
                align-items: center;
                justify-content: center;
                gap: 7px;
                min-height: 40px;
                padding: 0 11px;
                border: 1px solid var(--xy-line);
                border-radius: 8px;
                font-size: 12px;
                font-weight: 760;
                cursor: pointer;
                transform: scale(1);
                transition: transform .18s cubic-bezier(.2,.8,.2,1), border-radius .18s ease, border-color .2s ease, background .2s ease, box-shadow .2s ease, color .2s ease;
                will-change: transform;
            }
            .xy-action-btn-primary, .xy-submit-btn {
                border-color: var(--xy-graphite);
                background: var(--xy-graphite);
                color: #f8fbfa;
                box-shadow: 0 10px 20px rgba(17,19,21,.16);
            }
            .xy-action-btn-secondary {
                background: rgba(255,255,255,.56);
                color: #313938;
            }
            .xy-action-btn:hover, .xy-submit-btn:hover {
                position: relative;
                z-index: 2;
                border-radius: 14px;
                border-color: rgba(98,230,181,.74);
                box-shadow: 0 12px 24px rgba(20,73,58,.14), inset 0 0 0 1px rgba(98,230,181,.18);
                transform: scale(1.025);
            }
            .xy-action-btn:active, .xy-submit-btn:active, .xy-mini-btn:active, .xy-icon-btn:active {
                filter: brightness(.96);
            }
            .xy-action-btn:active, .xy-submit-btn:active {
                border-radius: 11px;
                transform: scale(.985);
                transition-duration: .08s;
            }
            .xy-action-btn:disabled, .xy-submit-btn:disabled, .xy-mini-btn:disabled {
                opacity: .56;
                cursor: wait;
                transform: none;
            }
            .xy-pdf-helper {
                margin: 6px 0 0 50%;
                color: var(--xy-muted);
                font-size: 10px;
                line-height: 1.4;
            }
            .xy-editor-section {
                margin-top: 14px;
            }
            .xy-editor-label-row {
                display: flex;
                align-items: baseline;
                justify-content: space-between;
                gap: 8px;
                margin-bottom: 7px;
            }
            .xy-editor-label {
                color: #323938;
                font-size: 11.5px;
                font-weight: 780;
            }
            #xy-ai-input {
                display: block;
                width: 100%;
                min-height: 128px;
                resize: vertical;
                padding: 10px 11px;
                border: 1px solid var(--xy-line-strong);
                border-radius: 8px;
                outline: none;
                background: rgba(245,247,247,.92);
                color: #28302f;
                font: 12px/1.6 Consolas, Monaco, monospace;
                transition: border-color .2s ease, box-shadow .2s ease, background .2s ease;
            }
            #xy-ai-input:focus {
                border-color: rgba(98,230,181,.92);
                background: rgba(255,255,255,.94);
                box-shadow: 0 0 0 3px rgba(98,230,181,.13);
            }
            .xy-submit-btn {
                display: flex;
                width: 100%;
                min-height: 42px;
                align-items: center;
                justify-content: center;
                gap: 8px;
                margin-top: 10px;
                border-radius: 8px;
                font-size: 12.5px;
                font-weight: 780;
                cursor: pointer;
                transform: scale(1);
                transition: transform .18s cubic-bezier(.2,.8,.2,1), border-radius .18s ease, border-color .2s ease, box-shadow .2s ease, filter .2s ease;
                will-change: transform;
            }
            #xy-status {
                min-height: 16px;
                margin-top: 8px;
                color: var(--xy-muted);
                font-size: 10.5px;
                line-height: 1.45;
            }
            .xy-footer-status {
                justify-content: space-between;
                gap: 8px;
                margin-top: 11px;
                padding-top: 10px;
                border-top: 1px solid var(--xy-line);
            }
            .xy-status-inline {
                min-width: 0;
                gap: 6px;
                color: var(--xy-muted);
                font-size: 10px;
                white-space: nowrap;
            }
            .xy-footer-dot {
                opacity: .42;
            }
            .xy-image-drawer, .xy-homework-drawer {
                position: absolute;
                z-index: 8;
                inset: 0;
                overflow: auto;
                padding: 15px;
                border-left: 1px solid var(--xy-line);
                background: rgba(250,252,251,.998);
                opacity: 0;
                pointer-events: none;
                transform: translateX(100%);
                transition: transform .24s cubic-bezier(.2,.72,.2,1), opacity .2s ease;
            }
            .xy-image-drawer.xy-drawer-open, .xy-homework-drawer.xy-drawer-open {
                opacity: 1;
                pointer-events: auto;
                transform: translateX(0);
            }
            .xy-drawer-title, .xy-result-title {
                color: var(--xy-graphite);
                font-size: 14px;
                font-weight: 800;
            }
            .xy-homework-form {
                margin-top: 13px;
            }
            .xy-homework-field {
                margin-top: 11px;
            }
            .xy-homework-label {
                display: block;
                margin-bottom: 6px;
                color: #37413f;
                font-size: 11px;
                font-weight: 780;
            }
            .xy-homework-input, .xy-homework-select {
                width: 100%;
                min-height: 34px;
                padding: 7px 9px;
                border: 1px solid var(--xy-line-strong);
                border-radius: 8px;
                background: rgba(245,247,247,.92);
                color: #28302f;
                font: 12px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                outline: none;
            }
            .xy-homework-input:focus, .xy-homework-select:focus {
                border-color: rgba(98,230,181,.86);
                background: rgba(255,255,255,.95);
                box-shadow: 0 0 0 3px rgba(98,230,181,.13);
            }
            .xy-homework-toggle {
                display: flex;
                align-items: center;
                gap: 8px;
                color: #37413f;
                font-size: 11.5px;
                font-weight: 740;
                cursor: pointer;
            }
            .xy-homework-toggle input {
                width: 15px;
                height: 15px;
                accent-color: var(--xy-mint-deep);
            }
            .xy-homework-actions {
                display: grid;
                grid-template-columns: repeat(2, minmax(0, 1fr));
                gap: 8px;
                margin-top: 14px;
            }
            .xy-homework-actions .xy-action-btn {
                min-height: 36px;
                font-size: 11.5px;
            }
            .xy-homework-actions .xy-action-btn:first-child {
                grid-column: 1 / -1;
            }
            @media (max-width: 360px) {
                .xy-action-grid, .xy-homework-actions {
                    grid-template-columns: 1fr;
                }
            }
            .xy-homework-meta {
                margin-top: 9px;
                color: var(--xy-muted);
                font-size: 10.5px;
                line-height: 1.5;
            }
            .xy-image-item {
                margin-top: 10px;
                padding-top: 10px;
                border-top: 1px solid var(--xy-line);
            }
            .xy-image-label {
                margin-bottom: 7px;
                color: #45504e;
                font-size: 11px;
                font-weight: 720;
            }
            .xy-image-preview {
                display: block;
                max-width: 100%;
                max-height: 220px;
                margin-bottom: 8px;
                border-radius: 7px;
                background: #eff2f1;
                object-fit: contain;
            }
            .xy-image-actions {
                gap: 7px;
            }
            .xy-mini-btn {
                display: inline-flex;
                min-height: 30px;
                flex: 1;
                align-items: center;
                justify-content: center;
                gap: 5px;
                border: 1px solid var(--xy-line);
                border-radius: 7px;
                background: rgba(255,255,255,.72);
                color: #4a5553;
                font-size: 10.5px;
                font-weight: 740;
                cursor: pointer;
                transform: scale(1);
                transition: transform .18s cubic-bezier(.2,.8,.2,1), border-radius .18s ease, border-color .18s ease, background .18s ease, box-shadow .18s ease;
                will-change: transform;
            }
            .xy-mini-btn:hover {
                z-index: 2;
                border-radius: 11px;
                border-color: rgba(98,230,181,.46);
                background: rgba(255,255,255,.94);
                box-shadow: 0 8px 16px rgba(31,91,72,.10);
                transform: scale(1.035);
            }
            .xy-mini-btn:active {
                border-radius: 9px;
                transform: scale(.96);
                transition-duration: .08s;
            }
            .xy-mini-btn-primary {
                border-color: rgba(98,230,181,.32);
                background: rgba(98,230,181,.12);
                color: #17694f;
            }
            .xy-empty-state {
                margin-top: 10px;
                padding: 11px;
                border: 1px dashed var(--xy-line-strong);
                border-radius: 8px;
                color: var(--xy-muted);
                font-size: 11px;
            }
            .xy-result-header {
                padding-bottom: 12px;
                border-bottom: 1px solid var(--xy-line);
            }
            .xy-score-block {
                padding: 15px 0 11px;
            }
            .xy-score-value {
                color: var(--xy-graphite);
                font-size: 34px;
                font-weight: 760;
                line-height: 1;
            }
            .xy-score-total {
                color: var(--xy-muted);
                font-size: 13px;
                font-weight: 650;
            }
            .xy-score-detail {
                margin-top: 8px;
                color: #66706f;
                font-size: 11px;
            }
            .xy-result-tabs {
                display: flex;
                gap: 17px;
                border-bottom: 1px solid var(--xy-line);
            }
            .xy-result-tab {
                position: relative;
                padding: 8px 0;
                border: none;
                background: transparent;
                color: var(--xy-muted);
                font-size: 10.5px;
                font-weight: 740;
                cursor: pointer;
                border-radius: 5px;
                transform: scale(1);
                transition: transform .18s cubic-bezier(.2,.8,.2,1), border-radius .18s ease, background .18s ease, color .18s ease;
                will-change: transform;
            }
            .xy-result-tab:hover {
                border-radius: 9px;
                background: rgba(98,230,181,.10);
                color: #17694f;
                transform: scale(1.045);
            }
            .xy-result-tab:active {
                border-radius: 7px;
                transform: scale(.97);
                transition-duration: .08s;
            }
            .xy-result-tab.xy-active {
                color: var(--xy-graphite);
            }
            .xy-result-tab.xy-active::after {
                position: absolute;
                right: 0;
                bottom: -1px;
                left: 0;
                height: 2px;
                background: var(--xy-mint);
                content: "";
            }
            .xy-result-list {
                margin-top: 4px;
            }
            .xy-result-section-title {
                margin-top: 10px;
                padding: 8px 9px;
                border-radius: 8px;
                background: rgba(17,19,21,.045);
                color: #313938;
                font-size: 11px;
                font-weight: 780;
                line-height: 1.5;
                white-space: pre-wrap;
                overflow-wrap: anywhere;
            }
            .xy-result-row {
                padding: 10px 0;
                border-bottom: 1px solid var(--xy-line);
                animation: xyFadeIn .22s ease both;
            }
            .xy-result-row-top {
                justify-content: space-between;
                gap: 8px;
            }
            .xy-result-question {
                color: #313938;
                font-size: 11.5px;
                font-weight: 760;
            }
            .xy-result-state {
                display: inline-flex;
                align-items: center;
                gap: 5px;
                color: #57615f;
                font-size: 10px;
                font-weight: 760;
                white-space: nowrap;
            }
            .xy-result-state::before {
                width: 6px;
                height: 6px;
                border-radius: 99px;
                background: currentColor;
                content: "";
            }
            .xy-tone-ok { color: #19865f; }
            .xy-tone-bad { color: var(--xy-danger); }
            .xy-tone-partial { color: var(--xy-warning); }
            .xy-tone-pending, .xy-tone-muted { color: #8a9392; }
            .xy-result-score {
                margin-top: 4px;
                color: var(--xy-muted);
                font-size: 10px;
            }
            .xy-answer-text {
                margin-top: 4px;
                color: #626c6b;
                font-size: 10.5px;
                line-height: 1.55;
                overflow-wrap: anywhere;
                white-space: pre-wrap;
            }
            .xy-answer-key {
                color: #8a9392;
            }
            .xy-result-note {
                margin-top: 10px;
                color: #96713b;
                font-size: 10.5px;
                line-height: 1.5;
            }
            @keyframes xyFadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
            }
            #xy-magic-box button:focus-visible {
                outline: 2px solid rgba(98,230,181,.72);
                outline-offset: 2px;
            }
            @media (prefers-reduced-motion: reduce) {
                .xy-result-row {
                    animation: none !important;
                }
                #xy-panel-shell, #xy-result-panel, .xy-image-drawer, .xy-homework-drawer, #xy-floating-trigger, .xy-action-btn, .xy-submit-btn, .xy-icon-btn, .xy-mini-btn, .xy-notice-action, .xy-result-tab {
                    transition: none !important;
                }
            }
        `;
        (document.head || document.documentElement).appendChild(style);
    }
    function renderSubmissionResultPanel() {
        const container = document.getElementById('xy-result-content');
        if (!container) return;
        container.innerHTML = '';
        if (!globalSubmissionResult || globalSubmissionResult.state !== 'submitted') {
            const empty = document.createElement('div');
            empty.className = 'xy-empty-state';
            empty.textContent = globalSubmissionResult?.message || '等待题目数据加载...';
            container.appendChild(empty);
            return;
        }
        const result = globalSubmissionResult;
        const questionResults = Array.isArray(result.questionResults) ? result.questionResults : [];
        const wrongCount = questionResults.filter(item => item.tone === 'bad').length;
        const partialCount = questionResults.filter(item => item.tone === 'partial').length;
        const badTabCount = wrongCount + partialCount;
        const pendingCount = questionResults.filter(item => item.tone === 'pending').length;
        const detailParts = [`${result.correctNum ?? '-'} 正确`, `${wrongCount} 错误`];
        if (partialCount > 0) detailParts.push(`${partialCount} 部分得分`);
        detailParts.push(`${pendingCount} 待批改`);
        const summary = document.createElement('div');
        summary.innerHTML = `
            <div class="xy-score-block">
                <span class="xy-score-value">${escapeHTML(result.actualScore ?? '-')}</span>
                <span class="xy-score-total"> / ${escapeHTML(result.totalScore ?? '-')} 分</span>
                <div class="xy-score-detail">${escapeHTML(detailParts.join(' · '))}</div>
            </div>
            <div class="xy-result-tabs">
                <button class="xy-result-tab ${resultFilter === 'all' ? 'xy-active' : ''}" type="button" data-filter="all">全部 ${escapeHTML(questionResults.length)}</button>
                <button class="xy-result-tab ${resultFilter === 'bad' ? 'xy-active' : ''}" type="button" data-filter="bad">错题 ${escapeHTML(badTabCount)}</button>
                <button class="xy-result-tab ${resultFilter === 'pending' ? 'xy-active' : ''}" type="button" data-filter="pending">待批改 ${escapeHTML(pendingCount)}</button>
            </div>
        `;
        container.appendChild(summary);
        if (!result.canShowStandardAnswer) {
            const note = document.createElement('div');
            note.className = 'xy-result-note';
            note.textContent = '平台未公开标准答案，本面板仅展示接口已返回的对错和分数。';
            container.appendChild(note);
        }
        const list = document.createElement('div');
        list.className = 'xy-result-list';
        const resultSections = Array.isArray(result.sections) && result.sections.length
            ? result.sections
            : [{ key: 'flat', titleText: '', isGroup: false, questionResults }];
        const filteredSections = resultSections.map(section => ({
            ...section,
            questionResults: section.questionResults.filter(item => {
                if (resultFilter === 'all') return true;
                if (resultFilter === 'bad') return item.tone === 'bad' || item.tone === 'partial';
                return item.tone === resultFilter;
            })
        })).filter(section => section.questionResults.length > 0);
        const filteredResults = filteredSections.flatMap(section => section.questionResults);
        if (filteredResults.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'xy-empty-state';
            empty.textContent = resultFilter === 'all' ? '暂无题目结果。' : '当前筛选项没有题目。';
            list.appendChild(empty);
        }
        filteredSections.forEach(section => {
            if (section.isGroup && section.titleText) {
                const sectionHeader = document.createElement('div');
                sectionHeader.className = 'xy-result-section-title';
                sectionHeader.textContent = section.titleText;
                list.appendChild(sectionHeader);
            }
            section.questionResults.forEach(item => {
                const row = document.createElement('div');
                row.className = 'xy-result-row';
                const questionLine = item.title
                    ? `<div class="xy-answer-text"><span class="xy-answer-key">题目：</span>${escapeHTML(item.title)}</div>`
                    : '';
                const standardLine = item.standardAnswer
                    ? `<div class="xy-answer-text"><span class="xy-answer-key">标准答案：</span>${escapeHTML(item.standardAnswer)}</div>`
                    : '';
                row.innerHTML = `
                    <div class="xy-result-row-top">
                        <div class="xy-result-question">${String(item.index).padStart(2, '0')} · ${escapeHTML(item.typeLabel)}</div>
                        <div class="xy-result-state xy-tone-${escapeHTML(item.tone || 'muted')}">${escapeHTML(item.stateLabel)}</div>
                    </div>
                    <div class="xy-result-score">${escapeHTML(item.scoreText)}</div>
                    ${questionLine}
                    <div class="xy-answer-text"><span class="xy-answer-key">我的答案：</span>${escapeHTML(item.userAnswer)}</div>
                    ${standardLine}
                `;
                list.appendChild(row);
            });
        });
        container.appendChild(list);
        container.querySelectorAll('.xy-result-tab').forEach(tab => {
            tab.onclick = () => {
                resultFilter = tab.dataset.filter || 'all';
                renderSubmissionResultPanel();
            };
        });
    }
    function clampNumber(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }
    function getDefaultCollapsedPosition() {
        return {
            left: Math.max(UI_MARGIN, window.innerWidth - DEFAULT_TRIGGER_WIDTH - 20),
            top: Math.max(UI_MARGIN, Math.round(window.innerHeight * 0.15))
        };
    }
    function getSavedCollapsedPosition() {
        try {
            const saved = JSON.parse(localStorage.getItem(UI_POSITION_KEY) || localStorage.getItem(LEGACY_UI_POSITION_KEY) || 'null');
            if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) {
                if (!localStorage.getItem(UI_POSITION_KEY)) localStorage.setItem(UI_POSITION_KEY, JSON.stringify(saved));
                return saved;
            }
        } catch (e) {
            localStorage.removeItem(UI_POSITION_KEY);
        }
        return getDefaultCollapsedPosition();
    }
    function clampPositionForSize(left, top, width, height) {
        const safeWidth = Math.min(width || DEFAULT_TRIGGER_WIDTH, window.innerWidth - UI_MARGIN * 2);
        const safeHeight = Math.min(height || 60, window.innerHeight - UI_MARGIN * 2);
        return {
            left: clampNumber(left, UI_MARGIN, Math.max(UI_MARGIN, window.innerWidth - safeWidth - UI_MARGIN)),
            top: clampNumber(top, UI_MARGIN, Math.max(UI_MARGIN, window.innerHeight - safeHeight - UI_MARGIN))
        };
    }
    function setBoxPosition(box, left, top) {
        box.style.left = `${left}px`;
        box.style.top = `${top}px`;
        box.style.right = 'auto';
    }
    function saveCollapsedPosition(position) {
        const trigger = document.getElementById('xy-floating-trigger');
        const width = trigger?.offsetWidth || DEFAULT_TRIGGER_WIDTH;
        const height = trigger?.offsetHeight || 58;
        const clamped = clampPositionForSize(position.left, position.top, width, height);
        localStorage.setItem(UI_POSITION_KEY, JSON.stringify(clamped));
        return clamped;
    }
    function applyCollapsedPosition(box = document.getElementById('xy-magic-box')) {
        if (!box) return;
        const trigger = document.getElementById('xy-floating-trigger');
        const saved = getSavedCollapsedPosition();
        const width = trigger?.offsetWidth || DEFAULT_TRIGGER_WIDTH;
        const height = trigger?.offsetHeight || 58;
        const clamped = clampPositionForSize(saved.left, saved.top, width, height);
        setBoxPosition(box, clamped.left, clamped.top);
    }
    function applyPanelLayout() {
        const shell = document.getElementById('xy-panel-shell');
        const resultPanel = document.getElementById('xy-result-panel');
        const mainPanel = document.getElementById('xy-panel');
        if (!shell || !mainPanel) return;
        const narrow = isNarrowPanelLayout();
        shell.classList.toggle('xy-narrow', narrow);
        shell.style.width = `${getDesiredShellWidth()}px`;
        mainPanel.style.order = '2';
        if (resultPanel) {
            resultPanel.style.order = '1';
            resultPanel.style.display = panelExpanded && resultPanelVisible ? 'block' : 'none';
        }
    }
    function getMainPanelWidth() {
        return Math.min(410, window.innerWidth - UI_MARGIN * 2);
    }
    function isNarrowPanelLayout() {
        return window.innerWidth < 760;
    }
    function getDesiredShellWidth() {
        const mainWidth = getMainPanelWidth();
        if (!resultPanelVisible || isNarrowPanelLayout()) return mainWidth;
        return Math.min(mainWidth + 310 + 10, window.innerWidth - UI_MARGIN * 2);
    }
    function applyExpandedPosition() {
        const box = document.getElementById('xy-magic-box');
        if (!box) return;
        const collapsed = getSavedCollapsedPosition();
        const triggerWidth = lastTriggerWidth || DEFAULT_TRIGGER_WIDTH;
        const shellWidth = getDesiredShellWidth();
        const boxHeight = Math.min(box.offsetHeight || window.innerHeight * 0.78, window.innerHeight - UI_MARGIN * 2);
        const left = collapsed.left + triggerWidth - shellWidth;
        const clamped = clampPositionForSize(left, collapsed.top, shellWidth, boxHeight);
        setBoxPosition(box, clamped.left, clamped.top);
    }
    function saveExpandedPositionAsCollapsedAnchor() {
        const box = document.getElementById('xy-magic-box');
        if (!box) return;
        const shellWidth = getDesiredShellWidth();
        const triggerWidth = lastTriggerWidth || DEFAULT_TRIGGER_WIDTH;
        const rect = box.getBoundingClientRect();
        saveCollapsedPosition({
            left: rect.left + shellWidth - triggerWidth,
            top: rect.top
        });
    }
    function clampUIPanelToViewport() {
        const box = document.getElementById('xy-magic-box');
        if (!box) return;
        if (panelExpanded) {
            applyExpandedPosition();
            return;
        }
        const rect = box.getBoundingClientRect();
        const trigger = document.getElementById('xy-floating-trigger');
        const width = trigger?.offsetWidth || rect.width || DEFAULT_TRIGGER_WIDTH;
        const height = trigger?.offsetHeight || rect.height || 58;
        const clamped = clampPositionForSize(rect.left, rect.top, width, height);
        setBoxPosition(box, clamped.left, clamped.top);
    }
    function makeUIPanelDraggable(box, handles) {
        let dragging = false;
        let moved = false;
        let startX = 0;
        let startY = 0;
        let startLeft = 0;
        let startTop = 0;
        const onMove = event => {
            if (!dragging) return;
            const dx = event.clientX - startX;
            const dy = event.clientY - startY;
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
            const width = Math.min(box.offsetWidth || 170, window.innerWidth - 16);
            const height = Math.min(box.offsetHeight || 60, window.innerHeight - 16);
            const nextLeft = clampNumber(startLeft + dx, 8, Math.max(8, window.innerWidth - width - 8));
            const nextTop = clampNumber(startTop + dy, 8, Math.max(8, window.innerHeight - height - 8));
            box.style.left = `${nextLeft}px`;
            box.style.top = `${nextTop}px`;
            box.dataset.dragMoved = moved ? '1' : '0';
        };
        const onUp = () => {
            if (!dragging) return;
            dragging = false;
            delete box.dataset.dragging;
            if (panelExpanded) {
                saveExpandedPositionAsCollapsedAnchor();
            } else {
                const rect = box.getBoundingClientRect();
                saveCollapsedPosition({ left: rect.left, top: rect.top });
            }
            setTimeout(() => { box.dataset.dragMoved = '0'; }, 80);
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
        };
        handles.forEach(handle => {
            if (!handle) return;
            handle.addEventListener('pointerdown', event => {
                if (handle.id !== 'xy-floating-trigger' && event.target.closest('button, textarea, input, select, a')) return;
                dragging = true;
                moved = false;
                startX = event.clientX;
                startY = event.clientY;
                const rect = box.getBoundingClientRect();
                startLeft = rect.left;
                startTop = rect.top;
                box.dataset.dragMoved = '0';
                box.dataset.dragging = '1';
                window.addEventListener('pointermove', onMove);
                window.addEventListener('pointerup', onUp);
            });
        });
    }
    function updateUIPanelData() {
        const floatingStatus = document.getElementById('xy-floating-status');
        if (floatingStatus) floatingStatus.innerText = globalQuestionsData.length > 0 ? `${globalQuestionsData.length} 道题已同步` : '等待同步题目';
        const status = document.getElementById('xy-status');
        if (status) status.innerText = globalQuestionsData.length > 0
            ? `${SCRIPT_NAME} 已读取 ${globalQuestionsData.length} 道题，检测到 ${globalImageAssets.length} 张图片。`
            : '等待题目数据加载...';
        const questionMetric = document.getElementById('xy-question-metric');
        if (questionMetric) questionMetric.textContent = `${globalQuestionsData.length} 道题已读取`;
        const imageMetric = document.getElementById('xy-image-metric');
        if (imageMetric) imageMetric.textContent = `${globalImageAssets.length} 张图片`;
        const taskState = document.getElementById('xy-task-state');
        if (taskState) taskState.textContent = globalQuestionsData.length ? '记录可保存' : '等待任务';
        const connectionStatus = document.getElementById('xy-connection-status');
        if (connectionStatus) connectionStatus.textContent = globalQuestionsData.length ? '已连接当前任务' : '等待连接任务';
        const resultToggle = document.getElementById('xy-result-toggle-btn');
        const hasSubmittedResult = globalSubmissionResult?.state === 'submitted';
        if (resultToggle) {
            resultToggle.disabled = !hasSubmittedResult;
            resultToggle.title = hasSubmittedResult ? '显示或隐藏提交结果' : '当前任务尚无已提交成绩';
        }
        renderImageAssets();
        renderSubmissionResultPanel();
        updateNoticeUI();
        updateImageDrawerUI();
        updateHomeworkDrawerUI();
        applyPanelLayout();
        clampUIPanelToViewport();
    }
    function updateImageDrawerUI() {
        const drawer = document.getElementById('xy-image-drawer');
        const button = document.getElementById('xy-image-drawer-btn');
        if (drawer) drawer.classList.toggle('xy-drawer-open', imageDrawerVisible);
        if (button) {
            button.setAttribute('aria-expanded', imageDrawerVisible ? 'true' : 'false');
            button.title = imageDrawerVisible ? '关闭题目图片' : '打开题目图片';
        }
    }
    function toggleImageDrawer(visible) {
        imageDrawerVisible = visible;
        if (visible) homeworkDrawerVisible = false;
        updateImageDrawerUI();
        updateHomeworkDrawerUI();
    }
    function updateHomeworkDrawerUI() {
        const drawer = document.getElementById('xy-homework-drawer');
        const button = document.getElementById('xy-homework-drawer-btn');
        if (drawer) drawer.classList.toggle('xy-drawer-open', homeworkDrawerVisible);
        if (button) {
            button.setAttribute('aria-expanded', homeworkDrawerVisible ? 'true' : 'false');
            button.title = homeworkDrawerVisible ? '关闭作业导出' : '打开作业导出';
        }
        const courseInput = document.getElementById('xy-course-name-input');
        if (courseInput && document.activeElement !== courseInput) {
            courseInput.value = getCurrentCourseName();
            courseInput.placeholder = globalCourseMeta.loading ? '正在读取课程名...' : '可手动填写课程名';
        }
        const headerSelect = document.getElementById('xy-homework-header-mode');
        if (headerSelect && document.activeElement !== headerSelect) {
            headerSelect.value = homeworkExportOptions.headerMode;
        }
        const answerToggle = document.getElementById('xy-homework-answers-toggle');
        if (answerToggle && document.activeElement !== answerToggle) {
            answerToggle.checked = homeworkExportOptions.includeAnswers;
        }
        const answerPosition = document.getElementById('xy-homework-answer-position');
        if (answerPosition) {
            if (document.activeElement !== answerPosition) {
                answerPosition.value = homeworkExportOptions.answerPosition;
            }
            answerPosition.disabled = !homeworkExportOptions.includeAnswers;
        }
        const meta = document.getElementById('xy-homework-meta');
        if (meta) {
            const title = globalPaperMeta.title || '未读取作业名';
            const course = getCurrentCourseName() || (globalCourseMeta.error ? '课程名读取失败，可手动填写' : '未读取课程名');
            meta.textContent = `${title} · ${globalQuestionsData.length} 道题 · ${course}`;
        }
    }
    function toggleHomeworkDrawer(visible) {
        homeworkDrawerVisible = visible;
        if (visible) imageDrawerVisible = false;
        updateImageDrawerUI();
        updateHomeworkDrawerUI();
    }
    function clearMainTransition() {
        uiTransitionToken += 1;
        if (uiTransitionTimer) clearTimeout(uiTransitionTimer);
        uiTransitionTimer = null;
        return uiTransitionToken;
    }
    function toggleUIPanel(expanded) {
        const trigger = document.getElementById('xy-floating-trigger');
        const panelShell = document.getElementById('xy-panel-shell');
        if (!trigger || !panelShell) return;
        const token = clearMainTransition();
        if (expanded) {
            lastTriggerWidth = trigger.getBoundingClientRect().width || trigger.offsetWidth || lastTriggerWidth || DEFAULT_TRIGGER_WIDTH;
        }
        panelExpanded = expanded;
        if (expanded) {
            markNoticeAsRead();
            trigger.classList.add('xy-trigger-hidden');
            panelShell.classList.remove('xy-shell-closing');
            panelShell.style.display = 'flex';
            applyPanelLayout();
            applyExpandedPosition();
            const raf = window.requestAnimationFrame || ((fn) => setTimeout(fn, 0));
            raf(() => {
                if (token === uiTransitionToken && panelExpanded) panelShell.classList.add('xy-shell-open');
            });
        } else {
            imageDrawerVisible = false;
            homeworkDrawerVisible = false;
            updateImageDrawerUI();
            updateHomeworkDrawerUI();
            panelShell.classList.add('xy-shell-closing');
            panelShell.classList.remove('xy-shell-open');
            uiTransitionTimer = setTimeout(() => {
                if (token !== uiTransitionToken || panelExpanded) return;
                panelShell.style.display = 'none';
                panelShell.classList.remove('xy-shell-closing');
                applyCollapsedPosition();
                trigger.classList.remove('xy-trigger-hidden');
            }, 190);
        }
    }
    function toggleResultPanel(visible) {
        const panelShell = document.getElementById('xy-panel-shell');
        const resultPanel = document.getElementById('xy-result-panel');
        if (!panelShell || !resultPanel) return;
        if (visible && globalSubmissionResult?.state !== 'submitted') {
            setUIStatus('当前任务尚未检测到已提交成绩。');
            return;
        }
        if (resultPanelTransitionTimer) clearTimeout(resultPanelTransitionTimer);
        resultPanelTransitionTimer = null;
        if (visible) {
            resultPanelVisible = true;
            applyPanelLayout();
            if (panelExpanded) applyExpandedPosition();
            resultPanel.classList.add('xy-result-fading');
            const raf = window.requestAnimationFrame || ((fn) => setTimeout(fn, 0));
            raf(() => resultPanel.classList.remove('xy-result-fading'));
            return;
        }
        resultPanel.classList.add('xy-result-fading');
        resultPanelTransitionTimer = setTimeout(() => {
            resultPanelVisible = false;
            resultPanel.style.display = 'none';
            resultPanel.classList.remove('xy-result-fading');
            applyPanelLayout();
            if (panelExpanded) applyExpandedPosition();
        }, 170);
    }
    function setButtonLabel(button, label) {
        const labelNode = button?.querySelector('[data-xy-label]');
        if (labelNode) labelNode.textContent = label;
    }
    function createUIPanel() {
        const existingBox = document.getElementById("xy-magic-box");
        if (existingBox) {
            updateUIPanelData();
            return;
        }
        if (!document.body) {
            setTimeout(createUIPanel, 100);
            return;
        }
        injectUIStyles();
        homeworkExportOptions = readHomeworkExportOptions();
        const box = document.createElement('div');
        box.id = "xy-magic-box";
        box.style.cssText = `
            position: fixed; z-index: 999999;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            color: #111827;
            max-width: calc(100vw - 16px);
        `;
        box.innerHTML = `
            <button id="xy-floating-trigger" type="button" title="点击展开，拖动移动位置">
                <span class="xy-floating-logo">${renderXyLogoSvg(40)}</span>
                <span class="xy-floating-copy">
                    <span class="xy-floating-title">小雅粘粘粘</span>
                    <span class="xy-floating-status-row">
                        <span class="xy-floating-dot"></span>
                        <span id="xy-floating-status">${globalQuestionsData.length > 0 ? `${globalQuestionsData.length} 道题已同步` : '等待同步题目'}</span>
                    </span>
                </span>
                <span class="xy-drag-grip"></span>
            </button>
            <div id="xy-panel-shell">
                <aside id="xy-result-panel" class="xy-panel-surface xy-surface-shimmer">
                    <div class="xy-result-scroll">
                        <div class="xy-result-header">
                            <div>
                                <div class="xy-result-title">提交结果</div>
                                <div class="xy-result-subtitle">本次作答</div>
                            </div>
                            <button id="xy-result-collapse-btn" class="xy-icon-btn" type="button" title="收起成绩">${renderIconSvg('chevron', 15)}</button>
                        </div>
                        <div id="xy-result-content"></div>
                    </div>
                </aside>
                <section id="xy-panel" class="xy-panel-surface xy-surface-shimmer">
                    <div class="xy-main-scroll">
                        <div id="xy-panel-drag-handle" class="xy-panel-header">
                            <div class="xy-brand">
                                <span class="xy-brand-logo">${renderXyLogoSvg(29)}</span>
                                <span>
                                    <span class="xy-title">小雅粘粘粘</span>
                                    <span class="xy-subtitle">v${SCRIPT_VERSION} · <span id="xy-connection-status">等待连接任务</span></span>
                                </span>
                            </div>
                            <div class="xy-header-actions">
                                <button id="xy-result-toggle-btn" class="xy-icon-btn" type="button" title="显示或隐藏提交结果">${renderIconSvg('results', 15)}</button>
                                <button id="xy-collapse-btn" class="xy-icon-btn" type="button" title="收起面板">${renderIconSvg('close', 15)}</button>
                            </div>
                        </div>
                        <div class="xy-notice-strip">
                            <div class="xy-notice-inline">
                                <span class="xy-status-dot"></span>
                                <span class="xy-notice-title">公告</span>
                                <span id="xy-notice-version-badge"></span>
                                <span id="xy-notice-body">公告加载中...</span>
                                <span class="xy-notice-actions">
                                    <button id="xy-notice-toggle" class="xy-notice-action" type="button">展开</button>
                                    <button id="xy-notice-refresh" class="xy-notice-action" type="button" title="刷新公告">${renderIconSvg('refresh', 12)}</button>
                                </span>
                            </div>
                            <div id="xy-notice-meta">公告加载中...</div>
                        </div>
                        <div class="xy-id-note">题目顺序可能与网页不同，保存时将按底层 ID 精准对应。</div>
                        <div class="xy-action-grid">
                            <button id="xy-copy-btn" class="xy-action-btn xy-action-btn-primary" type="button">${renderIconSvg('copy', 15)}<span data-xy-label>复制题目给 AI</span></button>
                            <button id="xy-pdf-btn" class="xy-action-btn xy-action-btn-secondary" type="button">${renderIconSvg('file', 15)}<span data-xy-label>导出图文 PDF</span></button>
                        </div>
                        <button id="xy-homework-drawer-btn" class="xy-action-btn xy-action-btn-secondary xy-homework-entry-btn" type="button" aria-expanded="false">${renderIconSvg('file', 15)}<span data-xy-label>导出作业</span></button>
                        <div class="xy-pdf-helper">${escapeHTML(PDF_SAVE_TIP)}</div>
                        <div class="xy-editor-section">
                            <div class="xy-editor-label-row">
                                <label class="xy-editor-label" for="xy-ai-input">AI 返回答案</label>
                                <span class="xy-helper">支持多行简答与匹配题</span>
                            </div>
                            <textarea id="xy-ai-input" placeholder="1 => A&#10;2 => B,C&#10;3 => const | let&#10;10 => A:a,d | B:b,c"></textarea>
                            <button id="xy-submit-btn" class="xy-submit-btn" type="button">${renderIconSvg('save', 15)}<span data-xy-label>保存作答记录</span></button>
                        </div>
                        <div id="xy-status">等待题目数据加载...</div>
                        <div class="xy-footer-status">
                            <div class="xy-status-inline">
                                <span class="xy-status-dot"></span>
                                <span id="xy-question-metric">0 道题已读取</span>
                                <span class="xy-footer-dot">·</span>
                                <span id="xy-task-state">等待任务</span>
                            </div>
                            <button id="xy-image-drawer-btn" class="xy-notice-action" type="button" aria-expanded="false">${renderIconSvg('image', 12)}<span id="xy-image-metric">0 张图片</span></button>
                        </div>
                    </div>
                    <aside id="xy-image-drawer" class="xy-image-drawer">
                        <div class="xy-drawer-header">
                            <div>
                                <div class="xy-drawer-title">题目图片</div>
                                <div class="xy-subtitle">预览、复制或提取链接</div>
                            </div>
                            <button id="xy-image-drawer-close" class="xy-icon-btn" type="button" title="关闭题目图片">${renderIconSvg('close', 15)}</button>
                        </div>
                        <div id="xy-image-list"></div>
                    </aside>
                    <aside id="xy-homework-drawer" class="xy-homework-drawer">
                        <div class="xy-drawer-header">
                            <div>
                                <div class="xy-drawer-title">导出作业</div>
                                <div class="xy-subtitle">纯净题目文档</div>
                            </div>
                            <button id="xy-homework-drawer-close" class="xy-icon-btn" type="button" title="关闭作业导出">${renderIconSvg('close', 15)}</button>
                        </div>
                        <div class="xy-homework-form">
                            <div class="xy-homework-field">
                                <label class="xy-homework-label" for="xy-course-name-input">课程名</label>
                                <input id="xy-course-name-input" class="xy-homework-input" type="text" value="${escapeHTML(getCurrentCourseName())}" placeholder="可手动填写课程名">
                            </div>
                            <div class="xy-homework-field">
                                <label class="xy-homework-label" for="xy-homework-header-mode">导出头部</label>
                                <select id="xy-homework-header-mode" class="xy-homework-select">
                                    <option value="course_homework">课程 + 作业名</option>
                                    <option value="course">只显示课程名</option>
                                    <option value="homework">只显示作业名</option>
                                    <option value="none">无头部</option>
                                </select>
                            </div>
                            <div class="xy-homework-field">
                                <label class="xy-homework-toggle">
                                    <input id="xy-homework-answers-toggle" type="checkbox">
                                    <span>导出正确答案</span>
                                </label>
                            </div>
                            <div class="xy-homework-field">
                                <label class="xy-homework-label" for="xy-homework-answer-position">答案位置</label>
                                <select id="xy-homework-answer-position" class="xy-homework-select">
                                    <option value="inline">题目下方</option>
                                    <option value="appendix">文末答案区</option>
                                </select>
                            </div>
                            <div id="xy-homework-meta" class="xy-homework-meta">等待题目数据加载...</div>
                            <div class="xy-homework-actions">
                                <button id="xy-homework-copy-btn" class="xy-action-btn xy-action-btn-primary" type="button">${renderIconSvg('copy', 15)}<span data-xy-label>复制纯作业文本</span></button>
                                <button id="xy-homework-pdf-btn" class="xy-action-btn xy-action-btn-secondary" type="button">${renderIconSvg('file', 15)}<span data-xy-label>导出 PDF</span></button>
                                <button id="xy-homework-doc-btn" class="xy-action-btn xy-action-btn-secondary" type="button">${renderIconSvg('file', 15)}<span data-xy-label>导出 DOC</span></button>
                            </div>
                        </div>
                    </aside>
                </section>
            </div>
        `;
        document.body.appendChild(box);
        applyCollapsedPosition(box);
        const trigger = document.getElementById('xy-floating-trigger');
        trigger.onclick = event => {
            if (box.dataset.dragMoved === '1') {
                event.preventDefault();
                return;
            }
            toggleUIPanel(true);
        };
        document.getElementById('xy-collapse-btn').onclick = () => toggleUIPanel(false);
        document.getElementById('xy-result-collapse-btn').onclick = () => toggleResultPanel(false);
        document.getElementById('xy-result-toggle-btn').onclick = () => toggleResultPanel(!resultPanelVisible);
        document.getElementById('xy-notice-toggle').onclick = toggleNoticeBody;
        document.getElementById('xy-notice-refresh').onclick = () => runNoticeCheck(true);
        document.getElementById('xy-image-drawer-btn').onclick = () => toggleImageDrawer(!imageDrawerVisible);
        document.getElementById('xy-image-drawer-close').onclick = () => toggleImageDrawer(false);
        document.getElementById('xy-homework-drawer-btn').onclick = () => toggleHomeworkDrawer(!homeworkDrawerVisible);
        document.getElementById('xy-homework-drawer-close').onclick = () => toggleHomeworkDrawer(false);
        makeUIPanelDraggable(box, [trigger, document.getElementById('xy-panel-drag-handle')]);
        if (!createUIPanel.resizeBound) {
            createUIPanel.resizeBound = true;
            window.addEventListener('resize', () => {
                applyPanelLayout();
                clampUIPanelToViewport();
            });
        }
        const copyBtn = document.getElementById('xy-copy-btn');
        copyBtn.onclick = function() {
            globalExtractedText = buildAiPromptText();
            GM_setClipboard(globalExtractedText, "text");
            setButtonLabel(copyBtn, "已复制题目模板");
            setUIStatus(`${SCRIPT_NAME} 已复制 ${globalQuestionsData.length} 道题。`);
            setTimeout(() => setButtonLabel(copyBtn, "复制题目给 AI"), 2000);
        };
        const courseInput = document.getElementById('xy-course-name-input');
        courseInput.oninput = () => {
            const courseName = courseInput.value.trim();
            globalCourseMeta = { ...globalCourseMeta, groupId: globalGroupId, courseName, error: '' };
            if (courseName) cacheCourseName(courseName);
            globalExtractedText = buildAiPromptText();
            updateHomeworkDrawerUI();
        };
        document.getElementById('xy-homework-header-mode').onchange = event => {
            homeworkExportOptions.headerMode = event.target.value;
            saveHomeworkExportOptions();
            updateHomeworkDrawerUI();
        };
        document.getElementById('xy-homework-answers-toggle').onchange = event => {
            homeworkExportOptions.includeAnswers = event.target.checked;
            saveHomeworkExportOptions();
            updateHomeworkDrawerUI();
        };
        document.getElementById('xy-homework-answer-position').onchange = event => {
            homeworkExportOptions.answerPosition = event.target.value;
            saveHomeworkExportOptions();
            updateHomeworkDrawerUI();
        };
        document.getElementById('xy-homework-copy-btn').onclick = copyHomeworkText;
        const homeworkPdfBtn = document.getElementById('xy-homework-pdf-btn');
        homeworkPdfBtn.onclick = async function() {
            homeworkPdfBtn.disabled = true;
            setButtonLabel(homeworkPdfBtn, "正在导出...");
            try {
                await exportHomeworkAsPdf();
            } catch (error) {
                console.error(`[${SCRIPT_NAME}] 作业 PDF 导出失败`, error);
                setUIStatus(`作业 PDF 导出失败：${error?.message || error}`, true);
            } finally {
                homeworkPdfBtn.disabled = false;
                setButtonLabel(homeworkPdfBtn, "导出 PDF");
            }
        };
        const homeworkDocBtn = document.getElementById('xy-homework-doc-btn');
        homeworkDocBtn.onclick = async function() {
            homeworkDocBtn.disabled = true;
            setButtonLabel(homeworkDocBtn, "正在导出...");
            try {
                await exportHomeworkAsDoc();
            } catch (error) {
                console.error(`[${SCRIPT_NAME}] 作业 DOC 导出失败`, error);
                setUIStatus(`作业 DOC 导出失败：${error?.message || error}`, true);
            } finally {
                homeworkDocBtn.disabled = false;
                setButtonLabel(homeworkDocBtn, "导出 DOC");
            }
        };
        const pdfBtn = document.getElementById('xy-pdf-btn');
        pdfBtn.onclick = async function() {
            pdfBtn.disabled = true;
            setButtonLabel(pdfBtn, "正在导出 PDF...");
            try {
                await exportPaperAsPdf();
            } catch (error) {
                console.error(`[${SCRIPT_NAME}] PDF 导出失败`, error);
                setUIStatus(`PDF 导出失败：${error?.message || error}`, true);
            } finally {
                pdfBtn.disabled = false;
                setButtonLabel(pdfBtn, "导出图文 PDF");
            }
        };
        const submitBtn = document.getElementById('xy-submit-btn');
        submitBtn.onclick = async function() {
            const aiText = document.getElementById('xy-ai-input').value;
            if(!aiText.trim()) { alert("请先粘贴 AI 返回的答案。"); return; }
            submitBtn.disabled = true;
            setButtonLabel(submitBtn, "正在保存作答...");
            setUIStatus(`${SCRIPT_NAME} 正在保存作答记录...`);
            try {
                await executeFill(aiText);
            } finally {
                submitBtn.disabled = false;
                setButtonLabel(submitBtn, "保存作答记录");
            }
        };
        updateUIPanelData();
        toggleUIPanel(false);
    }
    function mountUIPanelWhenReady() {
        if (document.body) {
            createUIPanel();
            return;
        }
        setTimeout(mountUIPanelWhenReady, 100);
    }
    installRouteWatcher();
    mountUIPanelWhenReady();
    initializeNoticeSystem();
})();
