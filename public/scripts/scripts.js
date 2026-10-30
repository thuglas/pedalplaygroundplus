var pedalImagePath = "public/images/pedals/";
var pedalboardImagePath = "public/images/pedalboards/";
var units = 'in';

$(document).ready(function () {

	// Restore My Collection (re-saving refreshes the cookie's expiry)
	myCollection = readCollection();
	saveCollection();
	$("#filter-collection").toggle(myCollection.length > 0);

	// Populate Pedalboards and Pedals lists
	GetPedalData();
	GetPedalBoardData();
	convertUnits();

	// Make lists searchable
	$(".pedal-list").select2({
		placeholder: "Select a pedal",
		width: "style",
	});

	$(".pedal-list").on("select2:select", function (e) {
		$("#add-selected-pedal").click();
		$(this).trigger("change").focus();
		//$(this).val(null).trigger('change').focus();
	});

	$(".pedalboard-list").select2({
		placeholder: "Select a pedalboard",
		width: "style",
	});

	// Styled right away to match the lists above; filled in once pedal data loads
	$(".collection-picker").select2({
		placeholder: "Add to my collection",
		width: "style",
	});

	// Remember the sidebar tab between visits
	var $sidebarTabs = $('.sidebar-tabs > .nav-tabs a[data-toggle="tab"]');
	$sidebarTabs.on("shown.bs.tab", function (e) {
		try {
			localStorage["sidebarTab"] = $(e.target).attr("href");
		} catch (err) {}
	});
	try {
		if (localStorage["sidebarTab"]) {
			$sidebarTabs.filter('[href="' + localStorage["sidebarTab"] + '"]').tab("show");
		}
	} catch (err) {}

	$(".pedalboard-list").on("select2:select", function (e) {
		$("#add-selected-pedalboard").click();
		$(this).trigger("change").focus();
		//$(this).val(null).trigger('change').focus();
	});

	$(function () {
		// Load canvas from localStorage if it has been saved prior
		if (localStorage["pedalCanvas"] != null) {
			var savedPedalCanvas = JSON.parse(localStorage["pedalCanvas"]);
			$(".canvas").html(savedPedalCanvas);
			readyCanvas();
		}

		// If hidden multiplier value doesn't exist, create it
		if ($("#multiplier").length == 0) {
			$(".canvas").append('<input id="multiplier" type="hidden" value="32">');
			var multiplier = 32;
			// If hidden multiplier value does exist set variable
		} else {
			var multiplier = $("#multiplier").val();
		}

		// Set canvas scale input and bg size to match scale
		$("#canvas-scale").val(multiplier);
		$(".canvas").css("background-size", multiplier + "px");

		restoreBoardFlipped();
	});

	$("#convert-units").on( "change", function() {
		convertUnits();
		renderCollection();
		$(document).trigger("playgroundchange");
	});

	// When user changes scale, update stuffs
	$("#canvas-scale").change(function () {
		// update var
		var multiplier = $(this).val();
		$("#multiplier").val(multiplier);

		// Update scale of bg image
		$(".canvas").css("background-size", multiplier + "px");

		// Update all items with stored scale
		$(".item").each(function () {
			$(this).attr("data-scale", multiplier);
		});

		// Update regular Pedals
		$(".pedalboard").each(function () {
			var scaledWidth = $(this).data("width") * multiplier;
			var scaledHeight = $(this).data("height") * multiplier;
			$(this).find(".artwork").css("width", scaledWidth).css("height", scaledHeight);
		});

		// Update regular Pedals
		$(".pedal, .pedalboard").each(function () {
			var scaledWidth = $(this).data("width") * multiplier;
			var scaledHeight = $(this).data("height") * multiplier;
			$(this).find(".artwork").css("width", scaledWidth).css("height", scaledHeight);
		});

		// Update custom pedals
		$(".pedal--custom, .pedalboard--custom").each(function () {
			var scaledWidth = $(this).data("width") * multiplier;
			var scaledHeight = $(this).data("height") * multiplier;
			$(this).css("width", scaledWidth).css("height", scaledHeight);
		});
		$(".pedalboard--custom").each(function () {
			var scaledWidth = $(this).data("width") * multiplier;
			var scaledHeight = $(this).data("height") * multiplier;
			$(this).css({
				width: scaledWidth,
				height: scaledHeight,
				borderWidth: multiplier * 0.5,
			});
		});

		savePedalCanvas();
	});

	$("body").on("click", ".sidebar-open", function (e) {
		$(".site-body").addClass("is-slid");
		e.preventDefault();
	});

	$("body").on("click", ".sidebar-close", function (e) {
		$(".site-body").removeClass("is-slid");
		e.preventDefault();
	});

	$("body").on("click", "#save-canvas", function (e) {
		const currentDate = new Date().toLocaleDateString() + new Date().toLocaleTimeString();

		downloadPedalCanvas("Pedal Playground - " + currentDate + ".json");
	});

	$("body").on("click", "#load-canvas", function (e) {
		uploadPedalCanvas();
		savePedalCanvas();
		readyCanvas();
	});

	$("body").on("click", "#clear-canvas-confirmation", function () {
		$(".canvas").empty();
		$("#clear-canvas-modal").modal("hide");
		// Signal Flow starts over too (its endpoints and Y cables aren't on the canvas);
		// only the signal type filters are kept
		if (window.SignalFlow) SignalFlow.setState({ hidden: SignalFlow.getState().hidden });
		savePedalCanvas();
	});

	$("body").on("click", "#add-selected-pedal", function (event) {
		var selected = $("#add-pedal").find(":selected");
		addPedalToCanvas(
			$(selected).text(),
			$(selected).attr("id"),
			$(selected).data("width"),
			$(selected).data("height"),
			$(selected).data("image")
		);
		event.preventDefault();
	});

	$("body").on("click", "#collect-selected-pedal", function (event) {
		collectSelected(this, $("#add-pedal").find(":selected"));
		event.preventDefault();
	});

	$("body").on("click", "#collect-selected-pedalboard", function (event) {
		collectSelected(this, $("#add-pedalboard").find(":selected"));
		event.preventDefault();
	});

	function collectSelected(button, $option) {
		var key = $option.data("key");
		if (!key) {
			flashButton(button, "Select one first");
			return;
		}
		addToCollection(key);
		flashButton(button, "Added to My Collection ✓");
	}

	// Add an item to the playground from My Collection
	$("body").on("click", ".collection-item__add", function (event) {
		var item = resolveCollectionItem($(this).closest(".collection-item").data("key"));
		if (item && item.status === "ok") {
			switch (item.kind) {
				case "pedal":
					addPedalToCanvas(item.label, undefined, item.width, item.height, item.image);
					break;
				case "board":
					addPedalboardToCanvas(item.label, undefined, item.width, item.height, item.image);
					break;
				case "custom-pedal":
					addCustomPedalToCanvas(item.name, item.width, item.height, item.color);
					break;
				case "custom-board":
					addCustomPedalboardToCanvas(item.width, item.height);
					break;
			}
		}
		event.preventDefault();
		event.stopPropagation();
	});

	// Edit mode shows the remove buttons, the picker and the Reverb import
	$("body").on("click", "#edit-collection", function (event) {
		var editing = !$("#my-collection").hasClass("is-editing");
		$("#my-collection").toggleClass("is-editing", editing);
		$(this)
			.text(editing ? "Done" : "Edit Collection")
			.attr("aria-pressed", editing)
			.toggleClass("btn-primary", editing)
			.toggleClass("btn-default", !editing);
		event.preventDefault();
	});

	// Removing asks first
	$("body").on("click", ".collection-item__remove", function (event) {
		var key = $(this).closest(".collection-item").data("key");
		$(".remove-collection-name").text(resolveCollectionItem(key).label);
		$("#remove-collection-confirm").data("key", key);
		$("#remove-collection-modal").modal("show");
		event.preventDefault();
		event.stopPropagation();
	});

	$("body").on("click", "#remove-collection-confirm", function () {
		removeFromCollection($(this).data("key"));
		$("#remove-collection-modal").modal("hide");
	});

	$("#reset-collection-modal").on("show.bs.modal", function () {
		$(".reset-collection-count").text(myCollection.length);
	});

	$("body").on("click", "#reset-collection-confirm", function () {
		setCollection([]);
		$("#reset-collection-modal").modal("hide");
	});

	$("body").on("input", "#filter-collection", function () {
		renderCollection();
	});

	$("body").on("click", "#save-workspace", function (e) {
		const currentDate = new Date().toLocaleDateString() + new Date().toLocaleTimeString();

		downloadWorkspace("Pedal Playground Workspace - " + currentDate + ".json");
	});

	$("body").on("click", "#load-workspace", function (e) {
		uploadWorkspace();
	});

	function addPedalToCanvas(name, shortname, width, height, i) {
		var multiplier = $("#canvas-scale").val();
		var serial = GenRandom.Job();
		var scaledWidth = width * multiplier;
		var scaledHeight = height * multiplier;
		var pedal =
			'\
<div id="item-' +
			serial +
			'" class="item pedal ' +
			shortname +
			'" title="' +
			name +
			'" data-width="' +
			width +
			'" data-height="' +
			height +
			'" data-scale="' +
			multiplier +
			'">\
	<div class="artwork" style="width:' +
			scaledWidth +
			"px;height:" +
			scaledHeight +
			"px; background-image:url(" +
			pedalImagePath +
			i +
			')"></div>\
	<div class="shadow"></div>\
	<div class="actions">\
		<a class="flip"></a>\
		<a class="rotate"></a>\
		<a class="delete"></a>\
	</div>\
</div>';
		$(".canvas").append(pedal);
		placeNewPedal("#item-" + serial);
		readyCanvas();
		ga("send", "event", "Pedal", "added", name);
	}

	$("body").on("click", "#add-selected-pedalboard", function (event) {
		var selected = $("#add-pedalboard").find(":selected");
		addPedalboardToCanvas(
			$(selected).text(),
			$(selected).attr("id"),
			$(selected).data("width"),
			$(selected).data("height"),
			$(selected).data("image")
		);
		event.preventDefault();
	});

	function addPedalboardToCanvas(name, shortname, width, height, i) {
		var serial = GenRandom.Job();
		var multiplier = $("#canvas-scale").val();
		var scaledWidth = width * multiplier;
		var scaledHeight = height * multiplier;
		var pedal =
			'\
<div id="item-' +
			serial +
			'" class="item pedalboard ' +
			shortname +
			'" title="' +
			name +
			'" data-width="' +
			width +
			'" data-height="' +
			height +
			'" data-scale="' +
			multiplier +
			'">\
	<div class="artwork" style="width:' +
			scaledWidth +
			"px;height:" +
			scaledHeight +
			"px; background-image:url(" +
			pedalboardImagePath +
			i +
			')"></div>\
	<div class="actions">\
		<a class="rotate"></a>\
		<a class="delete"></a>\
	</div>\
</div>';

		$(".canvas").prepend(pedal);
		readyCanvas();
		ga("send", "event", "Pedalboard", "added", name);
	}

	// Activate color picker plugin on custom color field
	$(".custom-color-block").colorpicker({
		color: "#41C74D",
	});

	// Read and validate the custom item forms; returns null (and flags the fields) when incomplete
	function readCustomForm(formId) {
		var $form = $(formId);
		var rawWidth = $form.find(".custom-width").val();
		var rawHeight = $form.find(".custom-height").val();

		$form.find(".invalid").removeClass("invalid");

		if (rawWidth == "" || rawHeight == "") {
			if (rawWidth == "") $form.find(".custom-width").addClass("invalid");
			if (rawHeight == "") $form.find(".custom-height").addClass("invalid");
			$form.find(rawWidth == "" ? ".custom-width" : ".custom-height").focus();
			return null;
		}

		return {
			width: convertUnitsIfNeeded("down", rawWidth),
			height: convertUnitsIfNeeded("down", rawHeight),
			name: $form.find(".custom-name").val() || "",
			color: $form.find(".custom-color").val() || "",
		};
	}

	// Add custom pedal
	$("body").on("click", "#add-custom-pedal .btn-primary", function (event) {
		var custom = readCustomForm("#add-custom-pedal");
		if (custom) {
			addCustomPedalToCanvas(custom.name, custom.width, custom.height, custom.color);
			event.preventDefault();
		}
	});

	$("body").on("click", "#collect-custom-pedal", function (event) {
		var custom = readCustomForm("#add-custom-pedal");
		if (custom) {
			addToCollection(customPedalKey(custom.width, custom.height, custom.color, custom.name));
			flashButton(this, "Added to My Collection ✓");
		}
		event.preventDefault();
	});

	function addCustomPedalToCanvas(name, width, height, image) {
		var serial = GenRandom.Job();
		var multiplier = $("#canvas-scale").val();
		var scaledWidth = width * multiplier;
		var scaledHeight = height * multiplier;
		var dims = width + '" x ' + height + '"';
		var pedal =
			'\
<div id="item-' +
			serial +
			'" class="item pedal pedal--custom" style="width:' +
			scaledWidth +
			"px;height:" +
			scaledHeight +
			'px;" title="' +
			name +
			'" data-width="' +
			width +
			'" data-height="' +
			height +
			'" data-scale="' +
			multiplier +
			'">\
	<span class="pedal__box" style="background-color:' +
			image +
			';"></span>\
	<span class="pedal__name">' +
			name +
			'</span>\
	<span class="pedal__jack1"></span>\
	<span class="pedal__jack2"></span>\
	<span class="pedal__knob1"></span>\
	<span class="pedal__knob2"></span>\
	<span class="pedal__led"></span>\
	<span class="pedal__switch"></span>\
	<div class="actions">\
		<a class="flip"></a>\
		<a class="rotate"></a>\
		<a class="delete"></a>\
	</div>\
</div>';

		$(".canvas").append(pedal);
		placeNewPedal("#item-" + serial);
		readyCanvas();
		ga("send", "event", "CustomPedal", "added", dims + " " + name);
	}

	// Add custom pedalboard
	$("body").on("click", "#add-custom-pedalboard .btn-primary", function (event) {
		var custom = readCustomForm("#add-custom-pedalboard");
		if (custom) {
			addCustomPedalboardToCanvas(custom.width, custom.height);
			event.preventDefault();
		}
	});

	$("body").on("click", "#collect-custom-pedalboard", function (event) {
		var custom = readCustomForm("#add-custom-pedalboard");
		if (custom) {
			addToCollection(customPedalboardKey(custom.width, custom.height));
			flashButton(this, "Added to My Collection ✓");
		}
		event.preventDefault();
	});

	function addCustomPedalboardToCanvas(width, height) {
		var serial = GenRandom.Job();
		var multiplier = $("#canvas-scale").val();
		var scaledWidth = width * multiplier;
		var scaledHeight = height * multiplier;
		var dims = width + '" x ' + height + '"';
		var pedalboard =
			'<div id="item-' +
			serial +
			'" class="item pedalboard pedalboard--custom" style="width:' +
			scaledWidth +
			"px;height:" +
			scaledHeight +
			"px; border-width:" +
			multiplier / 2 +
			'px" title="Custom Pedalboard" data-width="' +
			width +
			'" data-height="' +
			height +
			'" data-scale="' +
			multiplier +
			'">\
			<div class="actions">\
			<a class="delete"></a>\
			<a class="rotate"></a>\
			</div>\
			</div>';

		$(".canvas").prepend(pedalboard);
		readyCanvas();
		ga("send", "event", "CustomPedalboard", "added", dims);
	}

	// Typing in a text box or menu isn't a keyboard shortcut. jQuery runs this delegated
	// handler before the shortcuts bound directly on body below, and stops them.
	$("body").on("keydown keyup", "input, textarea, select, [contenteditable]", function (event) {
		event.stopImmediatePropagation();
	});

	// On keydown of "D" or "delete" remove pedal
	$("body").on("keydown keyup", function (event) {
		if (event.which == 68 || event.which == 8) {
			deleteSelected();
			$(".site-body > .item-info").remove();
			savePedalCanvas();
		}
	});

	// On keydown of "[", move pedal back
	$("body").on("keydown keyup", function (event) {
		if (event.which == 219) {
			$(".panel a[href='#back']").click();
			savePedalCanvas();
		}
	});

	// On keydown of "]", move pedal front
	$("body").on("keydown keyup", function (event) {
		if (event.which == 221) {
			$(".panel a[href='#front']").click();
			savePedalCanvas();
		}
	});

	// 37 - left
	// 38 - up
	// 39 - right
	// 40 - down

	// Move left
	$("body").on("keydown", function (event) {
		if (event.which == 37) {
			$(".canvas .selected, .canvas .group-selected").each(function () {
				$(this).css("left", (parseInt($(this).css("left")) || 0) - 1);
			});
			savePedalCanvas();
		}
	});

	// Move up
	$("body").on("keydown", function (event) {
		if (event.which == 38) {
			$(".canvas .selected, .canvas .group-selected").each(function () {
				$(this).css("top", (parseInt($(this).css("top")) || 0) - 1);
			});
			event.preventDefault();
			savePedalCanvas();
		}
	});

	// Move right
	$("body").on("keydown", function (event) {
		if (event.which == 39) {
			$(".canvas .selected, .canvas .group-selected").each(function () {
				$(this).css("left", (parseInt($(this).css("left")) || 0) + 1);
			});
			savePedalCanvas();
		}
	});

	// Move down
	$("body").on("keydown", function (event) {
		if (event.which == 40) {
			$(".canvas .selected, .canvas .group-selected").each(function () {
				$(this).css("top", (parseInt($(this).css("top")) || 0) + 1);
			});
			event.preventDefault();
			savePedalCanvas();
		}
	});

	$("body").on("keydown", function (event) {
		event.stopPropagation();

		//mvital: in some cases click event is sent multiple times to the handler - no idea why
		//mvital: seems calling stopImmediatePropagation() helps
		event.stopImmediatePropagation();

		if (event.which == 82) {
			$(".canvas .selected, .canvas .group-selected").each(function () {
				if ($(this).hasClass("rotate-90")) {
					$(this).removeClass("rotate-90");
					$(this).addClass("rotate-180");
				} else if ($(this).hasClass("rotate-180")) {
					$(this).removeClass("rotate-180");
					$(this).addClass("rotate-270");
				} else if ($(this).hasClass("rotate-270")) {
					$(this).removeClass("rotate-270");
				} else {
					$(this).addClass("rotate-90");
				}
			});
			savePedalCanvas();
		}
	});
}); // End Document ready

function convertUnitsIfNeeded(direction,value) {
	switch(direction) {
		case 'up':
			return ( $('#convert-units').is(':checked') ) ? convertIn(value) : value;
		case 'down':
			return ( $('#convert-units').is(':checked') ) ? convertMm(value) : value;
		default:
			break;
	}
}

function convertMm(value) {
	return Math.round((value * 0.0393701) * 100) / 100;
}

function convertIn(value) {
	return Math.round((value * 25.4));
}

function readyCanvas() {
	//console.log("canvas ready!");

	// Pedals saved before the underside existed get its button too
	$(".canvas .pedal .actions").each(function () {
		if (!$(this).find(".flip").length) $(this).prepend('<a class="flip"></a>');
	});
	$(".canvas .pedal").each(function () {
		updateFlipButton($(this));
	});

	var $draggable = $(".canvas .pedal, .canvas .pedalboard").draggabilly({
		containment: ".canvas",
	});

	$(".canvas .pedal, .canvas .pedalboard").draggabilly({
		containment: ".canvas",
	});

	$draggable.on("dragEnd", function (e) {
		//console.log("dragEnd");
		ga("send", "event", "Canvas", "moved", "dragend");
		savePedalCanvas();
	});

	// Move a green multi-select group together when any member is dragged.
	// Draggabilly's jQuery events fire on the element (they don't bubble), so
	// these are bound directly here. Namespaced + .off keeps them idempotent
	// across readyCanvas() re-inits.
	$draggable.off(".group");
	$draggable.on("dragStart.group", function () {
		if (!$(this).hasClass("group-selected")) return;
		// record each group member's starting position
		$(".canvas .group-selected").each(function () {
			$(this).data("grpStart", {
				left: parseFloat($(this).css("left")) || 0,
				top: parseFloat($(this).css("top")) || 0,
			});
		});
	});
	$draggable.on("dragMove.group", function () {
		if (!$(this).hasClass("group-selected")) return;
		var dragged = this; // Draggabilly moves this element itself
		var draggie = $(dragged).data("draggabilly");
		var draggedStart = $(dragged).data("grpStart");
		if (!draggie || !draggedStart) return;
		// use the dragged element's actual (containment-clamped) delta so the
		// rest of the group tracks it exactly, even at the canvas edge
		var dx = draggie.position.x - draggedStart.left;
		var dy = draggie.position.y - draggedStart.top;
		$(".canvas .group-selected").each(function () {
			if (this === dragged) return;
			var start = $(this).data("grpStart");
			if (!start) return;
			$(this).css({ left: start.left + dx, top: start.top + dy });
		});
	});

	// $draggable.on( 'staticClick', function(event) {

	$draggable.on("staticClick", function (event) {
		//rotatePedal(this);
		var target = $(event.target);
		if (target.is(".delete")) {
			deletePedal(this);
			deselect();
			$("body").click();
		} else if (target.is(".flip")) {
			event.stopPropagation();
			event.stopImmediatePropagation();
			toggleUnderside($(this));
		} else if (target.is(".rotate")) {
			event.stopPropagation();

			//mvital: in some cases click event is sent multiple times to the handler - no idea why
			//mvital: seems calling stopImmediatePropagation() helps
			event.stopImmediatePropagation();

			//rotatePedal(this);
			if ($(this).hasClass("rotate-90")) {
				$(this).removeClass("rotate-90");
				$(this).addClass("rotate-180");
			} else if ($(this).hasClass("rotate-180")) {
				$(this).removeClass("rotate-180");
				$(this).addClass("rotate-270");
			} else if ($(this).hasClass("rotate-270")) {
				$(this).removeClass("rotate-270");
			} else {
				$(this).addClass("rotate-90");
			}
			savePedalCanvas();
		}
	});
	savePedalCanvas();
}

function savePedalCanvas() {
	//console.log("Canvas Saved!");
	localStorage["pedalCanvas"] = JSON.stringify(canvasHtml());
	// Lets the Signal Flow and Parts List views keep up with the playground
	$(document).trigger("playgroundchange");
	// readyCanvas();
}

function exportPedalCanvas() {
	return new Blob(
		[ JSON.stringify(
			{
				source: "pedalplayground.com",
				version: "1.0",
				canvas: JSON.parse(localStorage["pedalCanvas"])
			}
		)],
		{ type: "application/json" }
	);
}

function downloadPedalCanvas(filename) {
	//console.log("Downloading canvas to " + filename);

	const blob = exportPedalCanvas();

	const url = window.URL.createObjectURL(blob);

	const a = document.createElement("a");
	a.style.display = "none";
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();

	window.URL.revokeObjectURL(url);
}

function importPedalCanvas(file) {
	//console.log("Importing canvas from " + file);

	var reader = new FileReader();

	reader.addEventListener(
		"load",
		() => {
			blob = JSON.parse(reader.result);

			// TODO: check source and version

			setBoardFlipped(false);
			$(".canvas").html(blob.canvas);
			readyCanvas();
		},
		false,
	);

	reader.readAsText(file);
}

function uploadPedalCanvas() {
	//console.log("Uploading canvas ...");
	var input = document.createElement("input");
	input.type = 'file';
	input.onchange = _ => {
		var file = input.files[0];
		importPedalCanvas(file);
	};
	input.click();
}

function rotatePedal(pedal) {
	ga("send", "event", "Pedal", "clicked", "rotate");
	if ($(pedal).hasClass("rotate-90")) {
		$(pedal).removeClass("rotate-90");
		$(pedal).addClass("rotate-180");
	} else if ($(pedal).hasClass("rotate-180")) {
		$(pedal).removeClass("rotate-180");
		$(pedal).addClass("rotate-270");
	} else if ($(pedal).hasClass("rotate-270")) {
		$(pedal).removeClass("rotate-270");
	} else {
		$(pedal).addClass("rotate-90");
	}
	savePedalCanvas();
}

// ------------------------------------------------------------------------------------
// Underside of the board
// Pedals can be mounted under the pedalboard (class "is-underside"). Normally they show
// faintly and can't be touched; flipping the board over shows the underside, where only
// those pedals can be moved. Flipping mirrors the layout left to right, as turning the
// board over would. Whether the board is flipped is a view setting: the canvas is always
// saved the right way up.

function isBoardFlipped() {
	return $(".canvas").hasClass("is-flipped");
}

// The line the layout is mirrored about: the middle of the pedalboards (so they stay
// put), or of everything when there's no board
function mirrorAxis() {
	var $items = $(".canvas .pedalboard");
	if (!$items.length) $items = $(".canvas .item");
	if (!$items.length) return null;
	var left = Infinity;
	var right = -Infinity;
	$items.each(function () {
		var x = parseFloat($(this).css("left")) || 0;
		left = Math.min(left, x);
		right = Math.max(right, x + itemWidth(this));
	});
	return (left + right) / 2;
}

function itemWidth(item) {
	return item.offsetWidth || ($(item).data("width") || 0) * ($(item).attr("data-scale") || 0);
}

function mirroredLeft(item, axis) {
	return Math.round(2 * axis - (parseFloat($(item).css("left")) || 0) - itemWidth(item));
}

function mirrorCanvas() {
	var axis = mirrorAxis();
	if (axis === null) return;
	$(".canvas .item").each(function () {
		$(this).css("left", mirroredLeft(this, axis));
	});
}

// The canvas markup the right way up, for saving
function canvasHtml() {
	if (!isBoardFlipped()) return $(".canvas").html();
	var axis = mirrorAxis();
	var $copy = $(".canvas").clone();
	$(".canvas .item").each(function () {
		$copy.find("#" + this.id).css("left", mirroredLeft(this, axis));
	});
	return $copy.html();
}

function setBoardFlipped(flipped) {
	$(".canvas .item-info, .item-info").remove();
	$(".canvas .selected, .canvas .group-selected").removeClass("selected group-selected");
	if (flipped !== isBoardFlipped()) mirrorCanvas();
	$(".canvas").toggleClass("is-flipped", flipped);
	$(".flip-board")
		.toggleClass("active", flipped)
		.attr("aria-pressed", flipped)
		.attr("title", flipped ? "Turn the board back over to the top" : "Flip the board over to see the underside")
		.find(".flip-board__text")
		.text(flipped ? "Underside" : "Flip Board");
	try {
		localStorage["boardFlipped"] = flipped ? "1" : "";
	} catch (err) {}
}

function updateFlipButton($pedal) {
	$pedal
		.find(".actions .flip")
		.attr("title", $pedal.hasClass("is-underside") ? "Move to the top of the board" : "Move to the underside of the board");
}

function toggleUnderside($pedal) {
	$pedal.toggleClass("is-underside").removeClass("selected group-selected");
	$(".item-info").remove();
	updateFlipButton($pedal);
	savePedalCanvas();
}

// Pedals added while looking at the underside are mounted there
function placeNewPedal(selector) {
	if (isBoardFlipped()) $(selector).addClass("is-underside");
}

// Called once the saved canvas has loaded
function restoreBoardFlipped() {
	var flipped = false;
	try {
		flipped = localStorage["boardFlipped"] === "1";
	} catch (err) {}
	setBoardFlipped(flipped);
}

$("body").on("click", ".flip-board", function (e) {
	setBoardFlipped(!isBoardFlipped());
	e.preventDefault();
	e.stopPropagation();
});

function deletePedal(pedal) {
	$(pedal).remove();
	deselect();
	savePedalCanvas();
}

function deselect() {
	$(".canvas .panel").remove();
	$(".canvas .selected").removeClass("selected");
	$(".canvas .group-selected").removeClass("group-selected");
	savePedalCanvas();
}

function deleteSelected() {
	$(".canvas .selected, .canvas .group-selected").remove();
	$(".canvas .panel").remove();
	savePedalCanvas();
}

// ------------------------------------------------------------------------------------
// My Collection
// Items are stored as short keys:
//   pedal          image filename (plus "~name" when two pedals share an image)
//   pedalboard     "b:" + the same, from the pedalboard list
//   custom pedal   "cp:" + width~height~color~name (inches)
//   custom board   "cb:" + width~height (inches)
// in a cookie, with localStorage as a fallback when the cookie would be too large.

var COLLECTION_COOKIE = "myCollection";
var COLLECTION_COOKIE_MAX = 3800; // browsers cap a cookie at ~4KB
var myCollection = [];
var pedalIndex = {};
var pedalboardIndex = {};
var pedalDataLoaded = false;
var pedalboardDataLoaded = false;

// Give each pedal / pedalboard a stable Key for collections
function assignKeys(items) {
	var imageCounts = {};
	items.forEach(function (item) {
		imageCounts[item.Image] = (imageCounts[item.Image] || 0) + 1;
	});
	items.forEach(function (item) {
		item.Key = imageCounts[item.Image] > 1 ? item.Image + "~" + item.Name : item.Image;
	});
}

function customPedalKey(width, height, color, name) {
	return "cp:" + [width, height, (color || "").replace(/^#/, ""), name || ""].join("~");
}

function customPedalboardKey(width, height) {
	return "cb:" + width + "~" + height;
}

// Size in the units chosen in Settings
function formatSize(width, height) {
	var unit = $("#convert-units").is(":checked") ? " mm" : '"';
	return convertUnitsIfNeeded("up", width) + unit + " x " + convertUnitsIfNeeded("up", height) + unit;
}

// Everything needed to show a collection key and add it to the playground.
// status is "ok", "pending" (its list hasn't loaded yet) or "missing" (no longer in the list).
function resolveCollectionItem(key) {
	var parts;
	if (key.indexOf("cp:") === 0) {
		parts = key.slice(3).split("~");
		return {
			status: "ok",
			kind: "custom-pedal",
			width: parseFloat(parts[0]),
			height: parseFloat(parts[1]),
			color: parts[2] ? "#" + parts[2] : "",
			name: parts.slice(3).join("~"),
			label: parts.slice(3).join("~") || "Custom Pedal",
			detail: "Custom pedal · " + formatSize(parts[0], parts[1]),
		};
	}
	if (key.indexOf("cb:") === 0) {
		parts = key.slice(3).split("~");
		return {
			status: "ok",
			kind: "custom-board",
			width: parseFloat(parts[0]),
			height: parseFloat(parts[1]),
			label: "Custom Pedalboard",
			detail: "Custom board · " + formatSize(parts[0], parts[1]),
		};
	}

	var isBoard = key.indexOf("b:") === 0;
	var entry = isBoard ? pedalboardIndex[key.slice(2)] : pedalIndex[key];
	if (!entry) {
		var loaded = isBoard ? pedalboardDataLoaded : pedalDataLoaded;
		return { status: loaded ? "missing" : "pending", label: isBoard ? key.slice(2) : key, detail: "" };
	}
	return {
		status: "ok",
		kind: isBoard ? "board" : "pedal",
		label: entry.Brand + " " + entry.Name,
		detail: isBoard ? "Pedalboard · " + formatSize(entry.Width, entry.Height) : "",
		width: entry.Width,
		height: entry.Height,
		image: entry.Image,
		thumb: (isBoard ? pedalboardImagePath : pedalImagePath) + entry.Image,
	};
}

function readCollection() {
	var match = document.cookie.match(new RegExp("(?:^|;\\s*)" + COLLECTION_COOKIE + "=([^;]*)"));
	if (match) {
		return match[1] ? match[1].split("|").map(decodeURIComponent) : [];
	}
	try {
		var saved = JSON.parse(localStorage[COLLECTION_COOKIE] || "[]");
		return Array.isArray(saved) ? saved : [];
	} catch (e) {
		return [];
	}
}

function saveCollection() {
	var value = myCollection.map(encodeURIComponent).join("|");
	var maxAge = 60 * 60 * 24 * 400; // 400 days, the longest browsers allow

	try {
		localStorage[COLLECTION_COOKIE] = JSON.stringify(myCollection);
	} catch (e) {}

	if (value.length > COLLECTION_COOKIE_MAX) {
		// Too big for a cookie: drop it so readCollection() falls back to localStorage
		document.cookie = COLLECTION_COOKIE + "=; max-age=0; path=/";
		$(".collection-note").text("Collection is too large for a cookie, so it's saved in this browser's local storage instead.").show();
	} else {
		document.cookie = COLLECTION_COOKIE + "=" + value + "; max-age=" + maxAge + "; path=/; SameSite=Lax";
		$(".collection-note").hide();
	}
}

function setCollection(keys) {
	myCollection = keys.filter(function (key, i) {
		return typeof key === "string" && keys.indexOf(key) === i;
	});
	saveCollection();
	renderCollection();
}

function addToCollection(key) {
	if (myCollection.indexOf(key) === -1) {
		setCollection(myCollection.concat([key]));
	}
}

function removeFromCollection(key) {
	setCollection(myCollection.filter(function (k) {
		return k !== key;
	}));
}

// Briefly swap a button's text to confirm an action
function flashButton(button, text) {
	var $button = $(button);
	if ($button.data("label") === undefined) $button.data("label", $button.html());
	$button.text(text).addClass("is-flashed");
	clearTimeout($button.data("flashTimer"));
	$button.data("flashTimer", setTimeout(function () {
		$button.html($button.data("label")).removeClass("is-flashed");
	}, 1500));
}

function initCollection(pedals) {
	// Build a searchable picker of every pedal, grouped by brand
	var groups = [];
	pedals.forEach(function (pedal) {
		pedalIndex[pedal.Key] = pedal;
		var group = groups[groups.length - 1];
		if (!group || group.text !== pedal.Brand) {
			group = { text: pedal.Brand, children: [] };
			groups.push(group);
		}
		group.children.push({ id: pedal.Key, text: pedal.Brand + " " + pedal.Name });
	});
	pedalDataLoaded = true;

	$(".collection-picker")
		.select2("destroy")
		.select2({
			placeholder: "Add to my collection",
			width: "style",
			data: groups,
			templateResult: function (item) {
				if (item.id && myCollection.indexOf(item.id) !== -1) {
					return $("<span>").text(item.text + "  ✓");
				}
				return item.text;
			},
		})
		.val(null)
		.trigger("change")
		.on("select2:select", function (e) {
			addToCollection(e.params.data.id);
			$(this).val(null).trigger("change");
		});

	renderCollection();
}

function initPedalboardCollection(pedalboards) {
	pedalboards.forEach(function (pedalboard) {
		pedalboardIndex[pedalboard.Key] = pedalboard;
	});
	pedalboardDataLoaded = true;
	renderCollection();
}

var COLLECTION_KIND_ORDER = { board: 0, "custom-board": 1, pedal: 2, "custom-pedal": 3 };

function kindOrder(item) {
	return item.kind in COLLECTION_KIND_ORDER ? COLLECTION_KIND_ORDER[item.kind] : 9;
}

function renderCollection() {
	var filter = ($("#filter-collection").val() || "").toLowerCase();
	var $list = $(".collection-list").empty();

	var items = myCollection.map(function (key) {
		var item = resolveCollectionItem(key);
		item.key = key;
		return item;
	});
	// Boards first, then pedals; alphabetical within each
	items.sort(function (a, b) {
		var kind = kindOrder(a) - kindOrder(b);
		if (kind) return kind;
		return a.label.toLowerCase() < b.label.toLowerCase() ? -1 : 1;
	});

	items.forEach(function (item) {
		var text = item.label + " " + item.detail;
		if (filter && text.toLowerCase().indexOf(filter) === -1) return;

		var $item = $('<li class="collection-item">').attr("data-key", item.key);
		var $text = $('<span class="collection-item__text">').append($("<span>").text(item.label));
		if (item.detail) {
			$text.append($("<small>").text(item.detail));
		}

		if (item.status === "ok") {
			var $thumb;
			if (item.thumb) {
				$thumb = $('<img alt="">').attr("src", item.thumb);
			} else {
				$thumb = $('<span class="collection-item__swatch">').addClass("collection-item__swatch--" + item.kind);
				if (item.color) $thumb.css("background-color", item.color);
			}
			$('<a href="#" class="collection-item__add" title="Add to playground">')
				.append($thumb, $text)
				.appendTo($item);
		} else {
			$('<span class="collection-item__missing">')
				.toggleClass("is-pending", item.status === "pending")
				.attr("title", item.status === "pending" ? "Loading…" : "No longer in the list")
				.append($text)
				.appendTo($item);
		}
		$('<button type="button" class="collection-item__remove" title="Remove from collection">&times;</button>').appendTo($item);
		$item.appendTo($list);
	});

	$(".collection-count").text(myCollection.length ? "(" + myCollection.length + ")" : "");
	$(".collection-empty").toggle(myCollection.length === 0);
	$("#filter-collection").toggle(myCollection.length > 0);
}

// ------------------------------------------------------------------------------------
// Workspace: the playground, My Collection and settings in one file

function exportWorkspace() {
	return new Blob(
		[ JSON.stringify(
			{
				source: "pedalplayground.com",
				type: "workspace",
				version: "1.0",
				canvas: JSON.parse(localStorage["pedalCanvas"] || '""'),
				collection: myCollection,
				signalFlow: window.SignalFlow ? SignalFlow.getState() : undefined,
				settings: {
					useMm: $("#convert-units").is(":checked"),
				},
			}
		)],
		{ type: "application/json" }
	);
}

function downloadWorkspace(filename) {
	const url = window.URL.createObjectURL(exportWorkspace());

	const a = document.createElement("a");
	a.style.display = "none";
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	a.remove();

	window.URL.revokeObjectURL(url);
}

function importWorkspace(file) {
	var reader = new FileReader();

	reader.addEventListener(
		"load",
		() => {
			var workspace;
			try {
				workspace = JSON.parse(reader.result);
			} catch (e) {
				alert("That file isn't a valid Pedal Playground workspace.");
				return;
			}

			if (workspace.canvas !== undefined) {
				setBoardFlipped(false);
				$(".canvas").html(workspace.canvas);
				// Canvas scale is stored inside the canvas as #multiplier
				var multiplier = $("#multiplier").val() || 32;
				$("#canvas-scale").val(multiplier);
				$(".canvas").css("background-size", multiplier + "px");
				readyCanvas();
			}

			if (Array.isArray(workspace.collection)) {
				setCollection(workspace.collection);
			}

			if (workspace.signalFlow && window.SignalFlow) {
				SignalFlow.setState(workspace.signalFlow);
			}

			if (workspace.settings && workspace.settings.useMm !== undefined) {
				$("#convert-units").prop("checked", !!workspace.settings.useMm);
				convertUnits();
			}
		},
		false,
	);

	reader.readAsText(file);
}

function uploadWorkspace() {
	var input = document.createElement("input");
	input.type = "file";
	input.accept = ".json,application/json";
	input.onchange = _ => {
		if (input.files[0]) importWorkspace(input.files[0]);
	};
	input.click();
}

function convertUnits() {
	if ( $('#convert-units').is(':checked') ) {
		var units = 'mm';
		$("label .units").text('(mm)');
		$('#custom-pb-width').attr('placeholder',610);
		$('#custom-pb-height').attr('placeholder',318);
		$('#custom-p-width').attr('placeholder',70);
		$('#custom-p-height').attr('placeholder',108);
	} else {
		var units = 'in';
		$("label .units").text('(inches)');
		$('#custom-pb-width').attr('placeholder',24);
		$('#custom-pb-height').attr('placeholder',12.5);
		$('#custom-p-width').attr('placeholder',2.75);
		$('#custom-p-height').attr('placeholder',4.25);
	}
}


window.Pedal = function (type, brand, name, width, height, image) {
	this.Type = type || "";
	this.Brand = brand || "";
	this.Name = name || "";
	this.Width = width || "";
	this.Height = height || "";
	this.Image = image || "";
};

window.GetPedalData = function () {
	// console.log('GetPedalData');
	$.ajax({
		url: "public/data/pedals.json",
		dataType: "text",
		type: "GET",
		success: function (data) {
			data = $.parseJSON(data.replace(/\r\n/g, "").replace(/\t/g, ""));
			var pedals = [];
			for (var pedal in data) {
				pedals.push(
					new Pedal(
						data[pedal].Type || "",
						data[pedal].Brand || "",
						data[pedal].Name || "",
						data[pedal].Width || "",
						data[pedal].Height || "",
						data[pedal].Image || ""
					)
				);
			}
			//Sort brands and pedals alphabetically
			pedals.sort(function (a, b) {
				if (a.Brand < b.Brand) {
					return -1;
				} else if (b.Brand < a.Brand) {
					return 1;
				} else {
					if (a.Name < b.Name) {
						return -1;
					} else if (b.Name < a.Name) {
						return 1;
					}
					return 0;
				}
			});
			assignKeys(pedals);
			pedals.forEach(RenderPedals);
			listPedals(pedals);
			initCollection(pedals);
		},
		error: showDataLoadError,
	});
};

window.RenderPedals = function (pedals) {
	var { Type, Brand, Name, Width, Height, Image, Key } = pedals;
	var option = $("<option>", {
		text: `${Brand} ${Name}`,
		// id: `${Name.toLowerCase().replace(/(\s+)|(['"])/g, (m, p1, p2) => p1 ? "-" : "")}`,
		data: {
			width: Width,
			height: Height,
			image: Image,
			key: Key,
		},
	});
	if ($("optgroup").is(`[label="${Brand}"]`)) {
		$(`optgroup[label="${Brand}"]`).append(option);
	} else {
		$("<optgroup>", {
			label: Brand,
			html: option,
		}).appendTo(".pedal-list");
	}
};

window.PedalBoard = function (brand, name, width, height, image) {
	this.Brand = brand || "";
	this.Name = name || "";
	this.Width = width || "";
	this.Height = height || "";
	this.Image = image || "";
};

window.GetPedalBoardData = function () {
	// console.log('GetPedalBoardData');
	$.ajax({
		url: "public/data/pedalboards.json",
		dataType: "text",
		type: "GET",
		success: function (data) {
			data = $.parseJSON(data.replace(/\r\n/g, "").replace(/\t/g, ""));
			var pedalboards = [];
			for (var pedalboard in data) {
				pedalboards.push(
					new PedalBoard(
						data[pedalboard].Brand || "",
						data[pedalboard].Name || "",
						data[pedalboard].Width || "",
						data[pedalboard].Height || "",
						data[pedalboard].Image || ""
					)
				);
			}
			//console.log("Pedalboard data loaded");
			//Sort brands and pedals alphabetically
			pedalboards.sort(function (a, b) {
				if (a.Brand < b.Brand) {
					return -1;
				} else if (b.Brand < a.Brand) {
					return 1;
				} else {
					if (a.Name < b.Name) {
						return -1;
					} else if (b.Name < a.Name) {
						return 1;
					}
					return 0;
				}
			});
			assignKeys(pedalboards);
			RenderPedalBoards(pedalboards);
			initPedalboardCollection(pedalboards);
		},
		error: showDataLoadError,
	});
};

// Pedal and pedalboard lists come from JSON files, which browsers won't load
// when the page is opened straight from disk (file://)
function showDataLoadError() {
	if ($(".data-load-error").length) return;
	var message = location.protocol === "file:"
		? "The pedal and pedalboard lists can't load when this page is opened as a file. " +
		  "Run start-local.cmd in the Pedal Playground folder (or any local web server) and open the page from there."
		: "The pedal and pedalboard lists failed to load. Check that public/data is reachable and reload the page.";
	$('<div class="data-load-error" role="alert">').text(message).prependTo(".sidebar__scroll");
}

window.RenderPedalBoards = function (pedalboards) {
	// console.log('RenderPedalBoards');
	for (var i in pedalboards) {
		// var $pedalboard = $("<option>"+ pedalboards[i].Brand + " " + pedalboards[i].Name +"</option>").attr('id', pedalboards[i].Name.toLowerCase().replace(/\s+/g, "-").replace(/'/g, ''));
		var $pedalboard = $(
			"<option>" + pedalboards[i].Brand + " " + pedalboards[i].Name + "</option>"
		);
		$pedalboard.data("width", pedalboards[i].Width);
		$pedalboard.data("height", pedalboards[i].Height);
		$pedalboard.data("height", pedalboards[i].Height);
		$pedalboard.data("image", pedalboards[i].Image);
		$pedalboard.data("key", "b:" + pedalboards[i].Key);
		$pedalboard.appendTo(".pedalboard-list");
	}
};

// List pedals on page to find errors
window.listPedals = function (pedals) {
	if ($("#list-pedals").length) {
		// console.log('List pedals...');
		for (var i in pedals) {
			multiplier = 40;
			Width = pedals[i].Width * multiplier;
			Height = pedals[i].Height * multiplier;

			var $pedalListing = $(
				'<div class="pedal-listing">\
				<img src="' +
					pedalImagePath +
					pedals[i].Image +
					'" alt="' +
					pedals[i].Brand +
					" " +
					pedals[i].Name +
					'" width="' +
					Width +
					'" height="' +
					Height +
					'"/>\
				<p class="pedal-brand">' +
					pedals[i].Brand +
					'</p>\
				<p class="pedal-name">' +
					pedals[i].Name +
					"</p>\
			</div>"
			);
			// $pedalListing.css('width', pedals[i].Width);
			// $pedalListing.css('height', pedals[i].Height);
			// $pedalListing.css('background-image', "url(" + pedals[i].Image + ")" );
			$pedalListing.appendTo("#list-pedals");
		}
	}
};

var GenRandom = {
	Stored: [],
	Job: function () {
		var newId = Date.now().toString().substr(3); // or use any method that you want to achieve this string
		if (!this.Check(newId)) {
			this.Stored.push(newId);
			return newId;
		}
		return this.Job();
	},
	Check: function (id) {
		for (var i = 0; i < this.Stored.length; i++) {
			if (this.Stored[i] == id) return true;
		}
		return false;
	},
};

$("body").on("click", ".item", function (e) {

	if ( $('#convert-units').is(':checked') ) {
		var units = 'mm';
	} else {
		var units = 'in';
	}

	var pedal = $(this);
	var id = $(this).attr("id");
	var pedalName = $(this).attr("title");

	var height = convertUnitsIfNeeded("up", $(this).attr("data-height") );
	var width = convertUnitsIfNeeded("up", $(this).attr("data-width") );;

	// Shift-click: build/modify a green multi-select group (no single-item panel)
	if (e.shiftKey) {
		if (pedal.hasClass("group-selected")) {
			// toggle this item out of the group
			pedal.removeClass("group-selected");
			var $group = $(".canvas .group-selected");
			// if only one remains, demote it back to a normal single selection
			if ($group.length === 1) {
				$group.removeClass("group-selected").addClass("selected");
			}
		} else {
			// promote any current single selection into the group, then add this item
			$(".item-info").remove();
			$(".canvas .selected").removeClass("selected").addClass("group-selected");
			pedal.addClass("group-selected");
		}
		e.stopPropagation();
		e.preventDefault();
		return;
	}

	var markup =
		'<div class="panel item-info" data-id="#' +
		id +
		'">\
    <div class="panel__name">' +
		pedalName +
		'<br><span class="panel__dimensions">(' + width + units + " x " + height + units + ')</span>\
    </div>\
		<a href="#rotate" class="panel__action">Rotate <i>R</i></a>\
		<a href="#front" class="panel__action">Move Front <i>]</i></a>\
		<a href="#back" class="panel__action">Move Back <i>[</i></a>\
		<a href="#delete" class="panel__action">Delete <i>D</i></a>\
		<span class="panel__action panel__tooltip">Multi-Select <i>SHIFT-CLICK</i></span>\
	</div>';

	// reset stuff
	$(".item-info").remove();
	$(".canvas .selected").removeClass("selected");
	$(".canvas .group-selected").removeClass("group-selected");

	// add stuff
	$(pedal).addClass("selected");
	$(".canvas").after(markup);

	// Prevent bubble up to .canvas
	e.stopPropagation();
});

$("body").on("click", 'a[href="#rotate"]', function (e) {
	e.stopPropagation();
	e.stopImmediatePropagation();

	var id = $(this).parents(".panel").data("id");
	if ($(id).hasClass("rotate-90")) {
		$(id).removeClass("rotate-90");
		$(id).addClass("rotate-180");
	} else if ($(id).hasClass("rotate-180")) {
		$(id).removeClass("rotate-180");
		$(id).addClass("rotate-270");
	} else if ($(id).hasClass("rotate-270")) {
		$(id).removeClass("rotate-270");
	} else {
		$(id).addClass("rotate-90");
	}
	savePedalCanvas();
});

$("body").on("click", 'a[href="#delete"]', function () {
	var id = $(this).parents(".panel").data("id");
	$(id).remove();
	$(".item-info").remove();
	savePedalCanvas();
});

$("body").on("click", 'a[href="#front"]', function (e) {
	e.stopImmediatePropagation();
	var id = $(this).parents(".panel").data("id");
	$(id).next().insertBefore(id);
	savePedalCanvas();
	e.stopPropagation();
});

$("body").on("click", 'a[href="#back"]', function (e) {
	e.stopImmediatePropagation();
	var id = $(this).parents(".panel").data("id");
	$(id).prev().insertAfter(id);
	savePedalCanvas();
	e.stopPropagation();
});

$("body").click(function () {
	// reset stuff
	$(".item-info").remove();
	$(".canvas .selected").removeClass("selected");
	$(".canvas .group-selected").removeClass("group-selected");
});

$("body").on("click", ".canvas", function (e) {
	$(".settings-popover").addClass("hide");
	$(".settings-trigger").removeClass("open");
});

$("body").on("click", ".settings-trigger", function (e) {
	$(".settings-popover").removeClass("hide");
	$(".settings-trigger").addClass("open");
	e.preventDefault();
	e.stopPropagation();
});


$("body").on("click", ".settings-trigger.open", function (e) {
	$(".settings-popover").addClass("hide");
	$(".settings-trigger").removeClass("open");
	e.preventDefault();
});

// ------------------------------------------------------------------------------------
// Main views (Playground / Signal Flow / Parts List). Each view element is marked with
// data-view-panel; views listen for "viewshown" to render themselves.

function showView(view) {
	// Clear any playground selection so its keyboard shortcuts don't act unseen
	$(".item-info").remove();
	$(".canvas .selected, .canvas .group-selected").removeClass("selected group-selected");

	$(".view-tab").each(function () {
		var active = $(this).data("view") === view;
		$(this).toggleClass("active", active).attr("aria-selected", active);
	});
	$("[data-view-panel]").each(function () {
		$(this).toggleClass("hide", $(this).data("view-panel") !== view);
	});
	// Flipping the board only applies to the layout
	$(".flip-board").toggleClass("hide", view !== "playground");
	$(document).trigger("viewshown", [view]);
}

$("body").on("click", ".view-tab", function (e) {
	showView($(this).data("view"));
	e.preventDefault();
});
