/*:
 * @target MZ
 * @plugindesc Tradução PT-BR por sobreposição de texto exibido (v0.1.0).
 * @author Projeto de tradução PT-BR
 * @help
 * Carregue LookOutside_PTBR_catalog antes deste plugin e este plugin por último.
 * Não modifica bancos de dados, scripts, nomes de arquivos nem saves.
 * Controle nesta sessão: LookOutsidePTBR.setEnabled(false / true).
 * Textos ausentes ou templates ambíguos mantêm o conteúdo original.
 * A ajuda ajusta suas descrições. Falas quebram na largura útil do retrato;
 * pausas, códigos e mudanças de página continuam sob controle do jogo.
 */
(function () {
    "use strict";

    const root = globalThis;
    if (root.LookOutsidePTBR && root.LookOutsidePTBR.version === "0.1.0") return;

    const data = root.LookOutsidePTBRData || {};
    const supplied = data.translations || {};
    const dictionary = new Map();
    const conflicting = new Set();
    const choiceBodies = new Map();
    const conflictingChoiceBodies = new Set();
    const templates = [];
    const cache = new Map();
    const messageSources = new WeakMap();
    const localizedMessageWindows = new WeakSet();
    const localizedMessageBitmaps = new WeakSet();
    const helpLayouts = new WeakMap();
    const counters = {
        catalogEntries: 0, conflictingEntries: 0, templateCount: 0,
        rejectedTemplates: 0, queries: 0, hits: 0, misses: 0,
        exactHits: 0, templateHits: 0, lineHits: 0, ambiguousTemplates: 0,
        helpFits: 0, helpScaled: 0, wrappedMessages: 0, messageWraps: 0
    };
    let enabled = true;
    let displayDepth = 0;
    // Reviewed exceptions for one display role only (speaker boxes, actor
    // names), when the same English text is also a battle term elsewhere.
    const scopedTranslations = data.scopedTranslations && typeof data.scopedTranslations === "object"
        ? data.scopedTranslations : {};
    let pendingScopedDisplay = null;

    function scoped(scope, text) {
        const table = scopedTranslations[scope];
        if (!table || typeof text !== "string" ||
            !Object.prototype.hasOwnProperty.call(table, text)) return undefined;
        return typeof table[text] === "string" ? table[text] : undefined;
    }

    function normalize(text) {
        return text.replace(/\r\n?/g, "\n");
    }

    function choiceParts(text) {
        let prefix = "";
        let body = text;
        // WD_ConditionalChoice parses these prefixes before displaying choices.
        // Keep their bytes and order, including switch/variable expressions.
        let match;
        while ((match = /^(?:<<\[[\s\S]*?\]>>|\(\(\[[\s\S]*?\]\)\))/.exec(body))) {
            prefix += match[0];
            body = body.slice(match[0].length);
        }
        return { prefix: prefix, body: body };
    }

    function insertUnique(map, conflicts, key, value) {
        if (conflicts.has(key)) return;
        if (map.has(key) && map.get(key) !== value) {
            map.delete(key);
            conflicts.add(key);
        } else {
            map.set(key, value);
        }
    }

    Object.keys(supplied).forEach(function (source) {
        const target = supplied[source];
        if (!source || typeof target !== "string" || !target) return;
        const key = normalize(source);
        const value = normalize(target);
        insertUnique(dictionary, conflicting, key, value);
        const sourceParts = choiceParts(key);
        if (sourceParts.prefix) {
            const targetParts = choiceParts(value);
            insertUnique(choiceBodies, conflictingChoiceBodies,
                sourceParts.body, targetParts.body);
        }
    });
    counters.catalogEntries = dictionary.size;
    counters.conflictingEntries = conflicting.size;

    function escapeRegex(text) {
        return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    function placeholderSignature(text) {
        return (text.match(/%[1-9]\d*/g) || []).sort().join(",");
    }

    dictionary.forEach(function (target, source) {
        if (!/%[1-9]\d*/.test(source) || choiceParts(source).prefix) return;
        const parts = source.split(/(%[1-9]\d*)/g);
        const literals = parts.filter(function (_, index) { return index % 2 === 0; });
        const literalText = literals.join("");
        // Do not turn naked placeholders, punctuation or adjacent placeholders
        // into broad matches. Only complete, anchored sentence templates apply.
        if (placeholderSignature(source) !== placeholderSignature(target) ||
            literalText.replace(/\s/g, "").length < 4 ||
            (literalText.match(/[A-Za-z]/g) || []).length < 3 ||
            /%[1-9]\d*\s*%[1-9]\d*/.test(source)) {
            counters.rejectedTemplates++;
            return;
        }
        const identifiers = [];
        let expression = "^";
        parts.forEach(function (part, index) {
            if (index % 2 === 0) expression += escapeRegex(part);
            else {
                identifiers.push(part);
                expression += "([^\\r\\n]+?)";
            }
        });
        expression += "$";
        templates.push({
            regex: new RegExp(expression), target: target,
            identifiers: identifiers, prefix: literals[0],
            suffix: literals[literals.length - 1],
            required: literals.reduce(function (a, b) { return a.length >= b.length ? a : b; }, "")
        });
    });
    counters.templateCount = templates.length;

    function direct(text) {
        const key = normalize(text);
        if (dictionary.has(key)) return dictionary.get(key);
        if (choiceBodies.has(key)) return choiceBodies.get(key);
        return undefined;
    }

    function translateTemplate(text) {
        let result;
        for (let i = 0; i < templates.length; i++) {
            const template = templates[i];
            if (!text.startsWith(template.prefix) || !text.endsWith(template.suffix) ||
                !text.includes(template.required)) continue;
            const match = template.regex.exec(text);
            if (!match || match[0] !== text) continue;
            const values = new Map();
            let valid = true;
            template.identifiers.forEach(function (identifier, index) {
                const value = match[index + 1];
                if (values.has(identifier) && values.get(identifier) !== value) valid = false;
                values.set(identifier, value);
            });
            if (!valid) continue;
            const candidate = template.target.replace(/%[1-9]\d*/g, function (identifier) {
                const value = values.get(identifier);
                const localized = direct(value);
                return localized === undefined ? value : localized;
            });
            if (result !== undefined && candidate !== result) {
                counters.ambiguousTemplates++;
                return undefined;
            }
            result = candidate;
        }
        return result;
    }

    function resolve(text, allowLines) {
        const parts = choiceParts(text);
        if (parts.prefix) {
            const full = dictionary.get(normalize(text));
            if (full !== undefined) {
                counters.exactHits++;
                return parts.prefix + choiceParts(full).body;
            }
            return parts.prefix + resolve(parts.body, allowLines);
        }
        const found = direct(text);
        if (found !== undefined) {
            counters.exactHits++;
            return found;
        }
        const formatted = translateTemplate(normalize(text));
        if (formatted !== undefined) {
            counters.templateHits++;
            return formatted;
        }
        if (allowLines && /[\r\n]/.test(text)) {
            const lines = text.split(/(\r\n|\r|\n)/);
            let changed = false;
            for (let index = 0; index < lines.length; index += 2) {
                const line = resolve(lines[index], false);
                if (line !== lines[index]) changed = true;
                lines[index] = line;
            }
            if (changed) {
                counters.lineHits++;
                return lines.join("");
            }
        }
        return text;
    }

    function translate(text) {
        if (!enabled || typeof text !== "string" || !text) return text;
        counters.queries++;
        if (cache.has(text)) return cache.get(text);
        const result = resolve(text, true);
        if (result !== text) counters.hits++;
        else counters.misses++;
        if (cache.size >= 4096) cache.clear();
        cache.set(text, result);
        return result;
    }

    function callDisplay(original, receiver, args) {
        displayDepth++;
        try {
            return original.apply(receiver, args);
        } finally {
            displayDepth--;
        }
    }

    function wrapDisplay(prototype, method) {
        if (!prototype || typeof prototype[method] !== "function") return;
        const original = prototype[method];
        prototype[method] = function () {
            if (!enabled || displayDepth || localizedMessageWindows.has(this) ||
                localizedMessageBitmaps.has(this)) return original.apply(this, arguments);
            const args = Array.prototype.slice.call(arguments);
            const pending = pendingScopedDisplay;
            args[0] = pending && args[0] === pending.source ? pending.target : translate(args[0]);
            return callDisplay(original, this, args);
        };
    }

    function translateChoices(choices) {
        if (!enabled || !Array.isArray(choices)) return choices;
        const profiles = Array.isArray(data.contextualChoices) ? data.contextualChoices : [];
        const profile = profiles.find(function (entry) {
            return Array.isArray(entry.choices) && entry.choices.length === choices.length &&
                entry.choices.every(function (source, index) { return source === choices[index]; });
        });
        return choices.map(function (source) {
            const scoped = profile && profile.translations && profile.translations[source];
            return typeof scoped === "string" ? scoped : translate(source);
        });
    }

    if (typeof Game_Message !== "undefined") {
        const prototype = Game_Message.prototype;
        const add = prototype.add;
        prototype.add = function (text) {
            const localized = translate(text);
            const texts = this._texts;
            const index = texts ? texts.length : 0;
            const result = add.call(this, localized);
            if (texts && texts === this._texts && texts.length === index + 1) {
                let record = messageSources.get(this);
                if (!record || record.texts !== texts) {
                    record = { texts: texts, entries: new Map() };
                    messageSources.set(this, record);
                }
                record.entries.set(index, { source: text, displayed: texts[index] });
            }
            return result;
        };
        const allText = prototype.allText;
        if (typeof allText === "function") {
            prototype.allText = function () {
                const text = allText.apply(this, arguments);
                const record = messageSources.get(this);
                let source = text;
                if (record && record.texts === this._texts &&
                    text === this._texts.join("\n")) {
                    source = this._texts.map(function (line, index) {
                        const entry = record.entries.get(index);
                        return entry && entry.displayed === line ? entry.source : line;
                    }).join("\n");
                }
                return enabled ? translate(source) : source;
            };
        }
        const clear = prototype.clear;
        if (typeof clear === "function") {
            prototype.clear = function () {
                messageSources.delete(this);
                return clear.apply(this, arguments);
            };
        }
        const setChoices = prototype.setChoices;
        if (typeof setChoices === "function") {
            prototype.setChoices = function (choices, defaultType, cancelType) {
                const localized = translateChoices(choices);
                return setChoices.call(this, localized, defaultType, cancelType);
            };
        }
        const setSpeakerName = prototype.setSpeakerName;
        if (typeof setSpeakerName === "function") {
            prototype.setSpeakerName = function (name) {
                if (!enabled || displayDepth) return setSpeakerName.apply(this, arguments);
                const args = Array.prototype.slice.call(arguments);
                const local = scoped("speakerName", name);
                args[0] = local !== undefined ? local : translate(name);
                return callDisplay(setSpeakerName, this, args);
            };
        }
    }

    if (typeof Window_StatusBase !== "undefined" &&
        typeof Window_StatusBase.prototype.drawActorName === "function") {
        const drawActorName = Window_StatusBase.prototype.drawActorName;
        Window_StatusBase.prototype.drawActorName = function (actor) {
            const name = enabled && actor && typeof actor.name === "function" ? actor.name() : undefined;
            const local = scoped("actorName", name);
            if (local === undefined) return drawActorName.apply(this, arguments);
            const previous = pendingScopedDisplay;
            pendingScopedDisplay = { source: name, target: local };
            try {
                return drawActorName.apply(this, arguments);
            } finally {
                pendingScopedDisplay = previous;
            }
        };
    }

    if (typeof Window_Base !== "undefined") {
        wrapDisplay(Window_Base.prototype, "drawText");
        wrapDisplay(Window_Base.prototype, "drawTextEx");
        wrapDisplay(Window_Base.prototype, "convertEscapeCharacters");
        const convert = Window_Base.prototype.convertEscapeCharacters;
        const bareItemMessages = [
            "You got the \\V[7] back.",
            "I got a\\C[3] \\V[7]."
        ];
        const fuzzyHelperMessage = "/N[8] tries to help the best it can, holding a piece of the bear\n" +
            "as you sew. It isn't really helping much, and is mostly in the way,\n" +
            "but you can tell its very important that it helps out.";
        Window_Base.prototype.convertEscapeCharacters = function (text) {
            // Item names inserted by variables are only available after the
            // engine resolves escapes. Localize known brace labels for display;
            // never write the translated value into game variables or saves.
            const variableLabel = enabled && typeof text === "string" &&
                /\{\\V\[\d+\]\}/i.test(text);
            // These two inspected item messages omit brace labels. Restrict
            // expansion to their exact source or catalog translation so other
            // uses of the shared temporary variable remain untouched.
            const bareItem = enabled && typeof text === "string" &&
                bareItemMessages.some(source => text === source || text === translate(source));
            const scoreVariable = enabled && typeof text === "string" && /\\V\[8\]/i.test(text);
            // Map333's original helper paragraph has a forward slash instead
            // of an actor-name escape. Repair only that inspected paragraph,
            // then let the native engine resolve the player's current pet name.
            const fuzzyHelper = enabled && typeof text === "string" &&
                (normalize(text) === fuzzyHelperMessage || normalize(text) === translate(fuzzyHelperMessage));
            const convertArgs = Array.prototype.slice.call(arguments);
            if (fuzzyHelper) convertArgs[0] = translate(text).replace("/N[8]", "\\N[8]");
            let converted = convert.apply(this, convertArgs);
            if (typeof converted !== "string") return converted;
            if (variableLabel) {
                converted = converted.replace(/\{([^{}\r\n]+)\}/g, function (label, name) {
                    const localized = direct(name);
                    return localized === undefined ? label : "{" + localized + "}";
                });
            }
            if (bareItem && typeof $gameVariables !== "undefined") {
                const name = $gameVariables.value(7);
                if (typeof name === "string" && name.length) {
                    const localized = direct(name);
                    if (localized !== undefined) converted = converted.replace(name, () => localized);
                }
            }
            if (scoreVariable && typeof $gameVariables !== "undefined") {
                const summary = $gameVariables.value(8);
                // Map274 composes this summary in a shared variable. Match its
                // complete score headers and footer before translating display;
                // unrelated uses of variable 8 and saved values stay untouched.
                if (typeof summary === "string" &&
                    /^Ending: [^\r\n]+ - -?\d+pts\nDays Elapsed: \d+ - -?\d+pts\nFriends: \d+ - -?\d+pts\nBosses Defeated: \d+ - -?\d+pts\n\n/.test(summary) &&
                    /\nScore : -?\d+\n(?:Easy - Multiplier: 1x|Normal - Multiplier: 2x|Hard - Multiplier: 3x)$/.test(summary)) {
                    converted = converted.replace(summary, () => translate(summary));
                }
            }
            return converted;
        };
    }
    if (typeof Bitmap !== "undefined") wrapDisplay(Bitmap.prototype, "drawText");

    if (typeof Window_Help !== "undefined") {
        const help = Window_Help.prototype;
        const reset = help.resetFontSettings;
        const draw = help.drawTextEx;
        const measure = help.textSizeEx;
        if (typeof reset === "function" && typeof draw === "function" && typeof measure === "function") {
            // Only this Window_Help instance gets a temporary font override.
            // textSizeEx and drawTextEx both reset fonts in MZ, so the override
            // must cover both calls. Message windows and global sizes stay intact.
            help.resetFontSettings = function () {
                const result = reset.apply(this, arguments);
                const layout = helpLayouts.get(this);
                if (layout && this.contents) this.contents.fontSize = layout.fontSize;
                return result;
            };

            help.drawTextEx = function (text, x, y, requestedWidth) {
                if (!enabled || displayDepth || !this.contents || typeof text !== "string" || !text) {
                    return draw.apply(this, arguments);
                }
                const bitmap = this.contents;
                const width = Math.min(Number(requestedWidth) > 0 ? Number(requestedWidth) : bitmap.width - x,
                    bitmap.width - x);
                const height = bitmap.height - y;
                if (!(width > 0 && height > 0)) return draw.apply(this, arguments);
                const fields = ["fontFace", "fontSize", "fontBold", "fontItalic", "textColor", "outlineColor", "outlineWidth"];
                const saved = {};
                fields.forEach(function (field) { saved[field] = bitmap[field]; });
                const localized = translate(text);
                let contextSaved = false;
                try {
                    reset.call(this);
                    const baseSize = Number(bitmap.fontSize) || 22;
                    const layout = { fontSize: baseSize };
                    helpLayouts.set(this, layout);
                    const self = this;
                    function sizeOf(value) {
                        return callDisplay(measure, self, [value]);
                    }
                    function reflow(value) {
                        // Database descriptions contain manual line breaks for
                        // the English layout. Reflow prose only inside Help;
                        // preserve paragraph breaks and all escape sequences.
                        const paragraphs = normalize(value).split(/\n[ \t]*\n/);
                        const lines = [];
                        paragraphs.forEach(function (paragraph, paragraphIndex) {
                            if (paragraphIndex) lines.push("");
                            const words = paragraph.replace(/\n/g, " ").split(/[ \t]+/).filter(Boolean);
                            let line = "";
                            words.forEach(function (word) {
                                const candidate = line ? line + " " + word : word;
                                const block = lines.concat([candidate]).join("\n");
                                if (line && sizeOf(block).width > width) {
                                    lines.push(line);
                                    line = word;
                                } else line = candidate;
                            });
                            lines.push(line);
                        });
                        return lines.join("\n");
                    }
                    let rendered = localized;
                    let dimensions = sizeOf(rendered);
                    if (dimensions.width > width || dimensions.height > height) {
                        for (let fontSize = baseSize; fontSize >= Math.min(12, baseSize); fontSize--) {
                            layout.fontSize = fontSize;
                            rendered = reflow(localized);
                            dimensions = sizeOf(rendered);
                            if (dimensions.width <= width && dimensions.height <= height) break;
                        }
                        counters.helpFits++;
                    }
                    // Extremely small Help areas still show the complete block,
                    // including icons. Scale only this synchronous canvas draw;
                    // ordinary game descriptions fit before reaching this path.
                    const scale = Math.min(1, width / Math.max(1, dimensions.width),
                        height / Math.max(1, dimensions.height));
                    const context = bitmap.context;
                    if (scale < 1 && context && typeof context.save === "function") {
                        context.save();
                        contextSaved = true;
                        context.translate(x, y);
                        context.scale(scale, scale);
                        counters.helpScaled++;
                        const result = callDisplay(draw, this, [rendered, 0, 0, width / scale]);
                        return typeof result === "number" ? result * scale : result;
                    }
                    return callDisplay(draw, this, [rendered, x, y, width]);
                } finally {
                    if (contextSaved) bitmap.context.restore();
                    helpLayouts.delete(this);
                    fields.forEach(function (field) { bitmap[field] = saved[field]; });
                }
            };
        }
    }

    // allText already localizes a complete paragraph. Prevent translating the
    // resulting Portuguese again while MZ renders it over subsequent frames.
    // Keep the game's customized startMessage and animation logic intact.
    function markLocalizedWindow(window) {
        localizedMessageWindows.add(window);
        if (window.contents) localizedMessageBitmaps.add(window.contents);
    }

    function wrapMessageWindow(constructor) {
        if (!constructor || typeof constructor.prototype.startMessage !== "function") return;
        const prototype = constructor.prototype;
        const original = prototype.startMessage;
        prototype.startMessage = function () {
            markLocalizedWindow(this);
            if (this._nameBoxWindow) {
                markLocalizedWindow(this._nameBoxWindow);
            }
            return callDisplay(original, this, arguments);
        };
    }
    if (typeof Window_Message !== "undefined") wrapMessageWindow(Window_Message);
    if (typeof Window_ScrollText !== "undefined") wrapMessageWindow(Window_ScrollText);

    if (typeof Window_Message !== "undefined" &&
        typeof Window_Message.prototype.createTextState === "function") {
        const create = Window_Message.prototype.createTextState;
        Window_Message.prototype.createTextState = function () {
            const state = create.apply(this, arguments);
            const bitmap = this.contents;
            if (!enabled || !state || typeof state.text !== "string" || !bitmap ||
                typeof bitmap.measureTextWidth !== "function" ||
                typeof this.newLineX !== "function" || !(this.innerWidth > 0)) return state;
            const margin = this.newLineX(state);
            const available = (state.rtl ? margin : this.innerWidth - margin) - 4;
            if (!(available > 0)) return state;
            // Explicit XY placement is authored layout, rather than flowing
            // prose. Do not move those coordinates or their associated text.
            if (/\x1bP[XY]\[/i.test(state.text)) return state;

            // Event-editor lines were sized for the English text. Reflow prose
            // paragraphs as a whole instead of treating those lines as layout.
            // Blank lines/pages and deliberately structured horror text retain
            // their boundaries. Inspect visible text, never remove effect codes.
            const flowingText = state.text.split(/(\f|(?:\r?\n){2,})/).map(function (block) {
                if (!/\n/.test(block) || /\f|(?:\r?\n){2}/.test(block)) return block;
                const lines = block.split(/\r?\n/);
                const prose = lines.every(function (line) {
                    const visible = line.replace(/\x1b(?:[A-Za-z]+(?:\[[^\]]*\])?|[^A-Za-z])/gu, "");
                    return !/^[ \t]|[ \t]{2}|^[•*\-–—]|^\d+[.)]\s/.test(visible) &&
                        /\p{L}[^\n]*\s+[^\n]*\p{L}/u.test(visible) &&
                        visible !== visible.toUpperCase();
                });
                return prose ? lines.join(" ") : block;
            }).join("");
            const reflowed = flowingText !== state.text;

            const fields = ["fontFace", "fontSize", "fontBold", "fontItalic", "textColor", "outlineColor", "outlineWidth"];
            const saved = {};
            fields.forEach(function (field) { saved[field] = bitmap[field]; });
            const output = [];
            let lineWidth = 0;
            let lastSpace = -1;
            let wraps = 0;
            let leading = true;
            let indented = false;
            let censored = Number(this._nbCharToIcon) || 0;
            const iconWidth = typeof ImageManager !== "undefined" ? ImageManager.iconWidth : 32;
            try {
                // newPage starts at the game's normal font; measure the same
                // font without changing any global or permanent window setting.
                if (typeof this.resetFontSettings === "function") this.resetFontSettings();
                const tokens = flowingText.match(/\x1b(?:[A-Za-z]+(?:\[[^\]]*\])?|[^A-Za-z])|[\s\S]/gu) || [];
                for (let index = 0; index < tokens.length; index++) {
                    const token = tokens[index];
                    let advance = 0;
                    if (token === "\n" || token === "\f" || token === "\r") {
                        output.push({ text: token, width: 0 });
                        lineWidth = 0;
                        lastSpace = -1;
                        leading = true;
                        indented = false;
                        continue;
                    }
                    if (token[0] === "\x1b") {
                        const control = /^\x1b([A-Za-z]+|.)(?:\[(\d+)\])?/u.exec(token);
                        const code = control ? control[1].toUpperCase() : "";
                        const parameter = control && control[2] !== undefined ? Number(control[2]) : 0;
                        if (code === "I") advance = iconWidth + 4;
                        else if (code === "J") advance = iconWidth;
                        else if (code === "FS" && parameter > 0) bitmap.fontSize = parameter;
                        else if (code === "{" && typeof this.makeFontBigger === "function") this.makeFontBigger();
                        else if (code === "}" && typeof this.makeFontSmaller === "function") this.makeFontSmaller();
                        else if (code === "T") censored = parameter;
                    } else if (token.charCodeAt(0) >= 0x20) {
                        advance = bitmap.measureTextWidth(token);
                        if (censored > 0) {
                            if (/^[A-Z]$/.test(token)) advance = iconWidth + 4;
                            else if (/^[a-z]$/.test(token)) advance = iconWidth + 4 - 2 * Math.floor(iconWidth / 4);
                            censored--;
                        }
                        // The game's randomized letter-to-icon effect may widen
                        // any lower-case glyph. Reserve its widest possible size.
                        if (typeof BattleManager !== "undefined" && BattleManager._goldLetterChance > 0 &&
                            /^[a-z]$/.test(token)) advance = Math.max(advance, iconWidth + 4);
                    }
                    output.push({ text: token, width: advance });
                    lineWidth += advance;
                    if (token === " " && leading) {
                        // Large authored indents are part of certain horror
                        // scenes. Keep every space; never turn them into empty
                        // lines or blank pages before the first word appears.
                        indented = true;
                        continue;
                    }
                    if (token === " ") lastSpace = output.length - 1;
                    else if (advance > 0) leading = false;
                    if (lineWidth <= available || advance === 0) continue;
                    if (lastSpace >= 0) {
                        // A space is the only original character removed. Every
                        // punctuation mark and escape token stays in order.
                        output[lastSpace] = { text: "\n", width: 0 };
                        lineWidth = output.slice(lastSpace + 1).reduce(function (sum, entry) {
                            return sum + entry.width;
                        }, 0);
                        lastSpace = -1;
                        leading = lineWidth === 0;
                        indented = false;
                    } else if (lineWidth > advance && !indented) {
                        // Unusually long names/words cannot overflow the bitmap.
                        output.splice(output.length - 1, 0, { text: "\n", width: 0 });
                        lineWidth = advance;
                    } else continue;
                    wraps++;
                }
                if (wraps || reflowed) {
                    state.text = output.map(function (entry) { return entry.text; }).join("");
                    state._lookOutsidePTBRWrapped = true;
                    counters.wrappedMessages++;
                    counters.messageWraps += wraps;
                }
                return state;
            } finally {
                fields.forEach(function (field) { bitmap[field] = saved[field]; });
            }
        };

        const newPage = Window_Message.prototype.newPage;
        if (typeof newPage === "function") {
            Window_Message.prototype.newPage = function (state) {
                const continuation = enabled && state && state._lookOutsidePTBRWrapped && state.index > 0 &&
                    !/\f\n?$/.test(state.text.slice(0, state.index));
                const styles = ["fontFace", "fontSize", "fontBold", "fontItalic", "textColor", "outlineColor", "outlineWidth"];
                const saved = {};
                if (continuation) {
                    styles.forEach(function (field) { saved[field] = this.contents[field]; }, this);
                    saved.autoSlow = this._autoSlow;
                    saved.iconLetters = this._nbCharToIcon;
                    saved.pauseSkip = this._pauseSkip;
                }
                const result = newPage.apply(this, arguments);
                if (continuation) {
                    // Extra visual lines can add an implicit page in the middle
                    // of an authored color/font/slow-text span. Keep that span
                    // active; explicit form-feed pages retain the game's reset.
                    styles.forEach(function (field) { this.contents[field] = saved[field]; }, this);
                    this._autoSlow = saved.autoSlow;
                    this._nbCharToIcon = saved.iconLetters;
                    this._pauseSkip = saved.pauseSkip;
                    state.height = this.calcTextHeight(state);
                }
                return result;
            };
        }
    }

    if (typeof Window_ChoiceList !== "undefined") {
        ["start", "makeCommandList"].forEach(function (method) {
            const original = Window_ChoiceList.prototype[method];
            if (typeof original !== "function") return;
            Window_ChoiceList.prototype[method] = function () {
                // setChoices already translated these labels. WD may still
                // strip logic prefixes or add a disabled-color escape here.
                markLocalizedWindow(this);
                return callDisplay(original, this, arguments);
            };
        });
    }

    root.LookOutsidePTBR = Object.freeze({
        version: "0.1.0",
        translate: translate,
        translateChoices: translateChoices,
        setEnabled: function (value) {
            enabled = !!value;
            cache.clear();
            return enabled;
        },
        isEnabled: function () { return enabled; },
        get stats() { return Object.freeze(Object.assign({}, counters)); },
        meta: Object.freeze(Object.assign({}, data.meta || {}))
    });
})();
