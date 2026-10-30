// ------------------------------------------------------------------------------------
// Import from Reverb
// Reads a Reverb "gear collection" CSV export, matches each row against the pedal and
// pedalboard lists, and lets the user review the matches before adding them to
// My Collection.
//
// Matching: the Reverb "make" must match the catalog brand (ignoring filler words like
// "Audio" or "Amps", and allowing "MXR" to match "MXR Custom Shop"), and the catalog
// model name must appear in the Reverb model as a run of whole words ("Zoia" in
// "Zoia Compact Grid Controller"). The longest such name wins, and color variants such
// as "H9 (Dark)" are preferred when the Reverb title or finish mentions them. Rows
// that only share some words are offered as "possible" matches, unchecked.

window.ReverbImport = (function ($) {
	var BRAND_FILLER = [
		"amp", "amps", "amplification", "audio", "by", "co", "company", "devices", "effect", "effects",
		"electronic", "electronics", "engineering", "fx", "guitar", "guitars", "inc", "industries",
		"instruments", "lab", "labs", "music", "pedal", "pedals", "sound", "system", "systems", "the",
	];
	// Words too common to justify a match on their own
	var GENERIC_WORDS = [
		"amp", "analog", "and", "bass", "boost", "booster", "chorus", "compressor", "delay", "deluxe",
		"digital", "distortion", "drive", "dual", "echo", "edition", "eq", "expression", "filter",
		"flanger", "fuzz", "guitar", "harmonizer", "limited", "looper", "mini", "multi", "octave",
		"of", "overdrive", "pedal", "phaser", "pitch", "plus", "preamp", "reverb", "synth", "the",
		"tremolo", "tuner", "vibrato", "volume", "wah",
	];
	var ROMAN = { ii: "2", iii: "3", iv: "4" };
	var STATUS_ORDER = { match: 0, possible: 1, collected: 2, none: 3 };

	var catalog = null; // prepared lazily from pedalIndex / pedalboardIndex
	var rows = [];

	// ----------------------------------------------------------------------------------
	// Text helpers

	function tokens(text) {
		var normalized = String(text || "")
			.normalize("NFKD")
			.replace(/[̀-ͯ]/g, "")
			.toLowerCase()
			.replace(/&/g, " and ")
			.replace(/\+/g, " plus ")
			.replace(/['’]/g, "");
		var out = [];
		normalized.split(/[^a-z0-9]+/).forEach(function (t) {
			if (!t) return;
			var mk = t.match(/^(mk|mark)(ii|iii|iv|\d+)$/);
			if (mk) {
				out.push("mk", ROMAN[mk[2]] || mk[2]);
				return;
			}
			if (t === "mark") t = "mk";
			out.push(ROMAN[t] || t);
		});
		return out;
	}

	function brandCore(tok) {
		var core = tok.filter(function (t) {
			return BRAND_FILLER.indexOf(t) === -1;
		});
		return core.length ? core : tok;
	}

	function startsWith(list, prefix) {
		if (!prefix.length || prefix.length > list.length) return false;
		for (var i = 0; i < prefix.length; i++) {
			if (list[i] !== prefix[i]) return false;
		}
		return true;
	}

	function brandMatches(makeCore, brand) {
		return (
			makeCore.join("") === brand.coreCompact ||
			startsWith(brand.core, makeCore) ||
			startsWith(makeCore, brand.core)
		);
	}

	// Where the name appears as a run of whole model words (word index), or -1. Word
	// splits may differ ("PackRat" / "Pack Rat"), so compare the run with spaces removed.
	function positionIn(nameCompact, modelTok) {
		if (!nameCompact) return -1;
		for (var i = 0; i < modelTok.length; i++) {
			var acc = "";
			for (var j = i; j < modelTok.length; j++) {
				acc += modelTok[j];
				if (acc === nameCompact) return i;
				if (acc.length >= nameCompact.length || nameCompact.indexOf(acc) !== 0) break;
			}
		}
		return -1;
	}

	// ----------------------------------------------------------------------------------
	// Catalog

	function prepareCatalog() {
		var brands = {};
		function add(item, kind) {
			var brandTok = tokens(item.Brand);
			var core = brandCore(brandTok);
			var id = core.join("");
			if (!brands[id]) {
				brands[id] = { core: core, coreCompact: id, tokens: brandTok, items: [] };
			}
			// "Lightspeed (Grayscale)" -> base "Lightspeed", variant "Grayscale"
			var parts = item.Name.match(/^(.*?)\s*\((.*)\)\s*$/);
			var baseTok = tokens(parts ? parts[1] : item.Name);
			brands[id].items.push({
				key: kind === "board" ? "b:" + item.Key : item.Key,
				kind: kind,
				label: item.Brand + " " + item.Name,
				baseTok: baseTok,
				baseCompact: baseTok.join(""),
				variantTok: parts ? tokens(parts[2]) : [],
			});
		}
		Object.keys(pedalIndex).forEach(function (key) {
			add(pedalIndex[key], "pedal");
		});
		Object.keys(pedalboardIndex).forEach(function (key) {
			add(pedalboardIndex[key], "board");
		});

		var all = [];
		Object.keys(brands).forEach(function (id) {
			all.push(brands[id]);
		});
		return { brands: all, byKey: indexByKey(all) };
	}

	function indexByKey(brands) {
		var byKey = {};
		brands.forEach(function (brand) {
			brand.items.forEach(function (item) {
				byKey[item.key] = item;
			});
		});
		return byKey;
	}

	// ----------------------------------------------------------------------------------
	// Matching

	function variantScore(item, extraWords) {
		if (!item.variantTok.length) return 0;
		var all = item.variantTok.every(function (t) {
			return extraWords[t];
		});
		return all ? 5 : -3; // prefer a named variant only when Reverb mentions it
	}

	function matchRow(row) {
		var makeTok = tokens(row.make);
		var titleTok = tokens(row.title);
		var candidates = [];
		var modelTok;

		if (makeTok.length) {
			var makeCore = brandCore(makeTok);
			catalog.brands.forEach(function (brand) {
				if (brandMatches(makeCore, brand)) candidates = candidates.concat(brand.items);
			});
			modelTok = tokens(row.model);
			if (!modelTok.length) {
				modelTok = startsWith(titleTok, makeTok) ? titleTok.slice(makeTok.length) : titleTok;
			}
		} else {
			// No make: the brand has to lead the title ("donner circle looper")
			catalog.brands.forEach(function (brand) {
				if (!candidates.length && startsWith(titleTok, brand.tokens)) {
					candidates = brand.items;
					modelTok = titleTok.slice(brand.tokens.length);
				}
			});
		}
		if (!candidates.length) return { status: "none" };

		var extraWords = {};
		titleTok.concat(tokens(row.finish), modelTok).forEach(function (t) {
			extraWords[t] = true;
		});

		// Whole-name matches: Reverb models lead with the product name and follow with a
		// description ("EQ2 Programmable EQ"), so the earliest match wins, then the longest
		var best = null;
		candidates.forEach(function (item) {
			var position = positionIn(item.baseCompact, modelTok);
			if (position === -1) return;
			var score = -position * 10000 + item.baseCompact.length * 10 + variantScore(item, extraWords);
			if (!best || score > best.score) best = { item: item, score: score };
		});
		if (best) return { status: "match", item: best.item };

		// Partial matches: most of the name's words, every number, and something distinctive
		candidates.forEach(function (item) {
			var nameTok = item.baseTok;
			if (!nameTok.length) return;
			var hits = nameTok.filter(function (t) {
				return extraWords[t];
			});
			var numbersOk = nameTok.every(function (t) {
				return !/\d/.test(t) || extraWords[t];
			});
			var distinctive = hits.some(function (t) {
				return GENERIC_WORDS.indexOf(t) === -1;
			});
			var coverage = hits.length / nameTok.length;
			if (!numbersOk || !distinctive || coverage < 0.5) return;
			var score = coverage * 100 + hits.length * 10 + variantScore(item, extraWords);
			if (!best || score > best.score) best = { item: item, score: score };
		});
		if (best) return { status: "possible", item: best.item };

		return { status: "none" };
	}

	// ----------------------------------------------------------------------------------
	// CSV

	function parseCsv(text) {
		var records = [];
		var record = [];
		var field = "";
		var quoted = false;
		text = text.replace(/^﻿/, "");

		for (var i = 0; i < text.length; i++) {
			var c = text[i];
			if (quoted) {
				if (c === '"' && text[i + 1] === '"') {
					field += '"';
					i++;
				} else if (c === '"') {
					quoted = false;
				} else {
					field += c;
				}
			} else if (c === '"') {
				quoted = true;
			} else if (c === ",") {
				record.push(field);
				field = "";
			} else if (c === "\n" || c === "\r") {
				if (c === "\r" && text[i + 1] === "\n") i++;
				record.push(field);
				records.push(record);
				record = [];
				field = "";
			} else {
				field += c;
			}
		}
		if (field || record.length) {
			record.push(field);
			records.push(record);
		}

		var header = (records.shift() || []).map(function (h) {
			return h.trim().toLowerCase();
		});
		return records
			.filter(function (r) {
				return r.some(function (v) {
					return v.trim();
				});
			})
			.map(function (r) {
				var obj = {};
				header.forEach(function (h, i) {
					obj[h] = (r[i] || "").trim();
				});
				return obj;
			});
	}

	// ----------------------------------------------------------------------------------
	// Review dialog

	// Searches the whole catalog without building thousands of <option>s per row
	function catalogSearch(params, success) {
		var words = tokens(params.data.term);
		var results = [];
		catalog.brands.some(function (brand) {
			brand.items.some(function (item) {
				var hay = tokens(item.label).join(" ");
				var all = words.every(function (w) {
					return hay.indexOf(w) !== -1;
				});
				if (all) results.push({ id: item.key, text: item.label + (item.kind === "board" ? " (pedalboard)" : "") });
				return results.length >= 50;
			});
			return results.length >= 50;
		});
		success({ results: results });
	}

	function statusLabel(row) {
		switch (row.status) {
			case "match":
				return "Match";
			case "possible":
				return "Possible";
			case "collected":
				return "In collection";
			default:
				return row.chosen ? "Chosen" : "No match";
		}
	}

	function renderRows() {
		var $body = $(".reverb-import__rows").empty();

		rows.forEach(function (row, index) {
			var $tr = $("<tr>").attr("data-index", index).addClass("is-" + row.status);
			var $check = $('<input type="checkbox" class="reverb-import__include">')
				.prop("checked", row.include)
				.prop("disabled", !row.chosen || row.status === "collected")
				.attr("aria-label", "Import " + row.title);
			$("<td>").append($check).appendTo($tr);

			var $source = $("<td>").append($('<div class="reverb-import__title">').text(row.make ? row.make + " " + row.model : row.title));
			var meta = [row.finish, row.year, (row.product_type || "").replace(/-/g, " ")].filter(Boolean).join(" · ");
			if (meta) $source.append($("<small>").text(meta));
			$tr.append($source);

			var $select = $('<select class="reverb-import__match">');
			if (row.chosen) {
				$select.append(new Option(catalog.byKey[row.chosen].label, row.chosen, true, true));
			}
			$("<td>").append($select).appendTo($tr);

			$("<td>").append($('<span class="reverb-import__status">').text(statusLabel(row))).appendTo($tr);
			$body.append($tr);

			$select.select2({
				placeholder: "Choose a match…",
				allowClear: true,
				width: "100%",
				minimumInputLength: 2,
				dropdownParent: $("#reverb-import-modal"),
				ajax: { transport: catalogSearch, delay: 150 },
			});
		});

		updateSummary();
	}

	function updateSummary() {
		var counts = { match: 0, possible: 0, none: 0, collected: 0 };
		rows.forEach(function (row) {
			counts[row.status]++;
		});
		var selected = selectedKeys().length;
		$(".reverb-import__summary").text(
			rows.length + " items in the export: " + counts.match + " matched, " + counts.possible +
			" possible, " + counts.none + " not found" + (counts.collected ? ", " + counts.collected + " already in My Collection" : "") + "."
		);
		$("#reverb-import-confirm")
			.prop("disabled", selected === 0)
			.text(selected ? "Add " + selected + " to My Collection" : "Add to My Collection");
	}

	function selectedKeys() {
		var keys = [];
		rows.forEach(function (row) {
			if (row.include && row.chosen && keys.indexOf(row.chosen) === -1 && myCollection.indexOf(row.chosen) === -1) {
				keys.push(row.chosen);
			}
		});
		return keys;
	}

	function open(file) {
		if (!pedalDataLoaded || !pedalboardDataLoaded) {
			alert("The pedal lists are still loading. Try again in a moment.");
			return;
		}
		catalog = catalog || prepareCatalog();

		var reader = new FileReader();
		reader.onload = function () {
			var records = parseCsv(reader.result);
			if (!records.length || !("make" in records[0]) || !("model" in records[0])) {
				alert("That doesn't look like a Reverb collection export (expected make and model columns).");
				return;
			}

			var seen = {};
			rows = records.map(function (record) {
				var result = matchRow(record);
				var row = $.extend({}, record, { status: result.status, chosen: result.item ? result.item.key : null });
				if (row.chosen && (myCollection.indexOf(row.chosen) !== -1 || seen[row.chosen])) {
					row.status = "collected";
				}
				if (row.chosen) seen[row.chosen] = true;
				row.include = row.status === "match";
				return row;
			});
			rows.sort(function (a, b) {
				return STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
			});

			$("#reverb-import-modal").modal("show");
			renderRows();
		};
		reader.readAsText(file);
	}

	// ----------------------------------------------------------------------------------
	// Events

	$(document).on("click", "#import-reverb", function (e) {
		var input = document.createElement("input");
		input.type = "file";
		input.accept = ".csv,text/csv";
		input.onchange = function () {
			if (input.files[0]) open(input.files[0]);
		};
		input.click();
		e.preventDefault();
	});

	$(document).on("change", ".reverb-import__include", function () {
		rows[$(this).closest("tr").data("index")].include = this.checked;
		updateSummary();
	});

	// Picking (or clearing) a match by hand
	$(document).on("change", ".reverb-import__match", function () {
		var $tr = $(this).closest("tr");
		var row = rows[$tr.data("index")];
		row.chosen = $(this).val() || null;
		if (row.status === "collected" && row.chosen && myCollection.indexOf(row.chosen) === -1) row.status = "none";
		row.include = !!row.chosen && row.status !== "collected";
		$tr.find(".reverb-import__include").prop({ checked: row.include, disabled: !row.chosen || row.status === "collected" });
		$tr.find(".reverb-import__status").text(statusLabel(row));
		updateSummary();
	});

	$(document).on("click", "#reverb-import-confirm", function () {
		var keys = selectedKeys();
		setCollection(myCollection.concat(keys));
		$("#reverb-import-modal").modal("hide");
		flashButton($("#import-reverb")[0], "Imported " + keys.length + " ✓");
	});

	return {
		parseCsv: parseCsv,
		matchRows: function (records) {
			catalog = catalog || prepareCatalog();
			return records.map(function (record) {
				var result = matchRow(record);
				return { status: result.status, key: result.item ? result.item.key : null, label: result.item ? result.item.label : "" };
			});
		},
		open: open,
	};
})(jQuery);
