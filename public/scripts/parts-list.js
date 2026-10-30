// ------------------------------------------------------------------------------------
// Parts List
// A spreadsheet-style list of everything in the project: the pedalboards and pedals on
// the playground (identical items are combined with a quantity) and the connectors
// (cables) drawn in the Signal Flow editor. Can be exported as CSV.

window.PartsList = (function ($) {
	var COLUMNS = [
		{ key: "category", label: "Category" },
		{ key: "brand", label: "Brand" },
		{ key: "item", label: "Item" },
		{ key: "details", label: "Details" },
		{ key: "sideA", label: "Side A", className: "parts-table__side" },
		{ key: "sideB", label: "Side B", className: "parts-table__side" },
		{ key: "length", label: "Length", className: "parts-table__length" },
		{ key: "size", label: "Size" },
		{ key: "qty", label: "Qty", numeric: true },
	];
	var CATEGORY_ORDER = { Pedalboard: 0, "Power Supply": 1, Pedal: 2, Connector: 3 };

	function isVisible() {
		return !$(".parts-list").hasClass("hide");
	}

	// Playground items only store their display title ("Brand Name"), so look the
	// brand and name back up in the loaded catalog
	var titleCache = new WeakMap();
	function catalogEntry(index, title) {
		var cached = titleCache.get(index);
		if (!cached || cached.size !== Object.keys(index).length) {
			var byTitle = {};
			Object.keys(index).forEach(function (key) {
				var entry = index[key];
				byTitle[entry.Brand + " " + entry.Name] = entry;
			});
			cached = { size: Object.keys(index).length, byTitle: byTitle };
			titleCache.set(index, cached);
		}
		return cached.byTitle[title];
	}

	function itemRow($item, category, index, customLabel) {
		var title = $item.attr("title") || "";
		var size = formatSize($item.attr("data-width"), $item.attr("data-height"));
		var custom = $item.is(".pedal--custom, .pedalboard--custom");
		if (custom) {
			var color = (($item.find(".pedal__box").attr("style") || "").match(/background-color:\s*([^;]+)/) || [])[1];
			return {
				category: category,
				brand: "Custom",
				item: (category === "Pedal" && title) || customLabel,
				details: color ? "Color " + color.trim() : "",
				sideA: "",
				sideB: "",
				size: size,
			};
		}
		var entry = catalogEntry(index, title);
		var row = {
			category: category,
			brand: entry ? entry.Brand : "",
			item: entry ? entry.Name : title,
			details: "",
			sideA: "",
			sideB: "",
			size: size,
		};
		// Power supplies are a subcategory of pedals, set in Signal Flow
		var info = category === "Pedal" && window.SignalFlow && SignalFlow.deviceInfo($item.attr("id"));
		if (info && info.kind === "supply") {
			row.category = "Power Supply";
			row.details = outputSummary(info.outputs);
		} else if (info && info.subcategory && info.subcategory !== "Effect") {
			row.details = info.subcategory;
		}
		return row;
	}

	// "8 outputs: 9V 500 mA ×6, 12V 500 mA ×2"
	function outputSummary(outputs) {
		var counts = {};
		var order = [];
		outputs.forEach(function (output) {
			var label = output.v + "V " + output.ma + " mA" + (output.sw ? " (switch)" : "");
			if (!counts[label]) order.push(label);
			counts[label] = (counts[label] || 0) + 1;
		});
		return outputs.length + (outputs.length === 1 ? " output: " : " outputs: ") + order.map(function (label) {
			return label + " ×" + counts[label];
		}).join(", ");
	}

	// One end of a cable: where it plugs in and the connector there,
	// e.g. "Strymon Zuma Out 1 (2.1mm barrel, center negative, 9V)"
	function endText(end, connector) {
		var port = end.port;
		var specs = [connector || port.connector || "connector not set"];
		if (port.voltage) specs.push(port.voltage + "V");
		return end.name + " " + port.label + " (" + specs.join(", ") + ")";
	}

	// A Y cable plug: "Tip / L → Alexander Slide Away In 1 (TS)", or loose
	function plugText(plug) {
		if (!plug.end) return plug.label + " → loose (" + (plug.connector || "connector not set") + ")";
		return plug.label + " → " + endText(plug.end, plug.connector);
	}

	// Lengths are typed in by hand; a daisy chain has one per segment ("A: 12 in; B: 6 in")
	function lengthText(segments) {
		return segments
			.filter(function (segment) {
				return segment.length;
			})
			.map(function (segment) {
				return (segment.label ? segment.label + ": " : "") + segment.length;
			})
			.join("; ");
	}

	// Side A is where the cable starts (the output); side B where it ends. A Y cable
	// has its single plug on side A and its two legs, one per line, on side B. A power
	// daisy chain has its supply output on side A and the pedals it feeds on side B.
	function cableRow(cable) {
		var row = cableColumns(cable);
		row.segments = cable.segments;
		row.length = lengthText(cable.segments);
		return row;
	}

	function cableColumns(cable) {
		if (cable.chain) {
			return {
				category: "Connector",
				brand: "",
				item: "Power daisy chain (" + cable.drops.length + " drops)",
				details: cable.type.label,
				sideA: cable.source ? endText(cable.source) : "not connected to a supply",
				sideB: cable.drops
					.map(function (drop) {
						return endText(drop);
					})
					.join("\n"),
				size: "",
				qty: 1,
			};
		}
		if (cable.junction) {
			var side = function (name) {
				return cable.plugs
					.filter(function (plug) {
						return plug.side === name;
					})
					.map(plugText)
					.join("\n");
			};
			return {
				category: "Connector",
				brand: "",
				item: cable.junction.name + " (" + cable.junction.detail + ")",
				details: cable.type.label,
				sideA: side("A"),
				sideB: side("B"),
				size: "",
				qty: 1,
			};
		}
		return {
			category: "Connector",
			brand: "",
			item: cable.type.cable,
			details: cable.type.label,
			sideA: endText(cable.from),
			sideB: endText(cable.to),
			size: "",
			qty: 1,
		};
	}

	function collectRows() {
		var grouped = {};
		var rows = [];

		function addRow(row) {
			var id = [row.category, row.brand, row.item, row.details, row.size].join("|");
			if (grouped[id]) {
				grouped[id].qty++;
			} else {
				row.qty = 1;
				grouped[id] = row;
				rows.push(row);
			}
		}

		$(".canvas .item.pedalboard").each(function () {
			addRow(itemRow($(this), "Pedalboard", pedalboardIndex, "Custom Pedalboard"));
		});
		$(".canvas .item.pedal").each(function () {
			var row = itemRow($(this), "Pedal", pedalIndex, "Custom Pedal");
			if ($(this).hasClass("is-underside")) row.details = [row.details, "Under the board"].filter(Boolean).join("; ");
			addRow(row);
		});

		rows.sort(function (a, b) {
			return (
				CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category] ||
				a.brand.localeCompare(b.brand) ||
				a.item.localeCompare(b.item)
			);
		});

		// Each cable is its own row, in the order they were connected
		if (window.SignalFlow) {
			SignalFlow.getCables().forEach(function (cable) {
				rows.push(cableRow(cable));
			});
		}

		return rows;
	}

	function render() {
		var rows = collectRows();
		var $table = $(".parts-table");

		var $headRow = $("<tr>").append($('<th class="parts-table__num">'));
		COLUMNS.forEach(function (col) {
			$("<th>").text(col.label).toggleClass("is-numeric", !!col.numeric).appendTo($headRow);
		});
		$table.find("thead").empty().append($headRow);

		var $body = $table.find("tbody").empty();
		rows.forEach(function (row, i) {
			var $tr = $("<tr>").addClass("parts-row--" + row.category.toLowerCase());
			$('<td class="parts-table__num">').text(i + 1).appendTo($tr);
			COLUMNS.forEach(function (col) {
				var $td = $("<td>").toggleClass("is-numeric", !!col.numeric).addClass(col.className || "").appendTo($tr);
				if (col.key === "length" && row.segments) $td.append(lengthInputs(row.segments));
				else $td.text(row[col.key]);
			});
			$body.append($tr);
		});

		// Totals per category
		var totals = { Pedalboard: 0, "Power Supply": 0, Pedal: 0, Connector: 0 };
		rows.forEach(function (row) {
			totals[row.category] += row.qty;
		});
		var summary = [
			totals.Pedalboard + (totals.Pedalboard === 1 ? " pedalboard" : " pedalboards"),
			totals.Pedal + (totals.Pedal === 1 ? " pedal" : " pedals"),
			totals.Connector + (totals.Connector === 1 ? " connector" : " connectors"),
		];
		if (totals["Power Supply"]) {
			summary.splice(1, 0, totals["Power Supply"] + (totals["Power Supply"] === 1 ? " power supply" : " power supplies"));
		}
		summary = summary.join(", ");
		var $foot = $table.find("tfoot").empty();
		$("<tr>")
			.append($('<td class="parts-table__num">'))
			.append($("<td>").attr("colspan", COLUMNS.length).text(summary))
			.appendTo($foot);

		$(".parts-list__empty").toggle(rows.length === 0);
		$table.toggle(rows.length > 0);
		$("#export-parts-csv").prop("disabled", rows.length === 0);

		// Brands come from the catalog, so redraw once it has finished loading
		if (!(window.pedalDataLoaded && window.pedalboardDataLoaded)) {
			setTimeout(function () {
				if (isVisible()) render();
			}, 500);
		}
	}

	// One box per segment, labeled A, B, ... for a daisy chain
	function lengthInputs(segments) {
		return segments.map(function (segment) {
			var $input = $('<input type="text" class="parts-length__input form-control input-sm" placeholder="Length">')
				.val(segment.length)
				.attr({ "data-id": segment.id, "aria-label": "Length" + (segment.title ? " of " + segment.title : "") });
			return $('<label class="parts-length">')
				.attr("title", segment.title || "")
				.append(segment.label ? $('<span class="parts-length__label">').text(segment.label) : null, $input);
		});
	}

	function csvCell(value) {
		var text = String(value === undefined || value === null ? "" : value);
		return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
	}

	function exportCsv() {
		var lines = [COLUMNS.map(function (col) {
			return csvCell(col.label);
		}).join(",")];
		collectRows().forEach(function (row) {
			lines.push(COLUMNS.map(function (col) {
				return csvCell(row[col.key]);
			}).join(","));
		});

		// BOM so Excel reads the file as UTF-8
		var blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
		var url = window.URL.createObjectURL(blob);
		var a = document.createElement("a");
		a.style.display = "none";
		a.href = url;
		a.download = "Pedal Playground Parts List.csv";
		document.body.appendChild(a);
		a.click();
		a.remove();
		window.URL.revokeObjectURL(url);
	}

	$(document).on("viewshown", function (e, view) {
		if (view === "parts-list") render();
	});

	$(document).on("playgroundchange", function () {
		if (isVisible()) render();
	});

	// Saved as you type; the table isn't redrawn, so the box keeps focus
	$(document).on("input change", ".parts-length__input", function () {
		if (window.SignalFlow) SignalFlow.setLength($(this).data("id"), $.trim(this.value));
	});

	$(document).on("click", "#export-parts-csv", function (e) {
		exportCsv();
		e.preventDefault();
	});

	return {
		getRows: collectRows,
	};
})(jQuery);
