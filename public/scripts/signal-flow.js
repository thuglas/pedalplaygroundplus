// ------------------------------------------------------------------------------------
// Signal Flow editor
// A conceptual view of the pedals on the playground: each pedal is a box with its
// inputs on the left and outputs on the right. Boxes can be moved, and dragging
// from a port to an opposite port (output -> input, or input -> output) of the same
// signal type connects them. Clicking a connection removes it. Each signal type has its
// own color, and the filter buttons hide a type's ports and cables.
//
// Power supplies have a row of outputs, each with a voltage, a current limit and
// optionally a voltage switch. Pedals have a power jack with the voltage and current
// they need. Every power chain is checked, and when a new cable would give a pedal the
// wrong voltage or overload an output, a dialog offers a fix: set the output's switch,
// a series cable (two outputs, double the voltage) or a parallel Y cable (two outputs,
// double the current). Connecting a stereo TRS jack to a mono TS jack offers a Y cable.
// Y cables are small boxes of their own, so their spare leg can be plugged in anywhere.

window.SignalFlow = (function ($) {
	var STORAGE_KEY = "signalFlow";
	var NODE_WIDTH = 180;
	var JUNCTION_WIDTH = 140;
	var NODE_GAP_X = 90;
	var NODE_GAP_Y = 60;
	var NODE_HEIGHT_ESTIMATE = 150;
	var SVG_NS = "http://www.w3.org/2000/svg";

	// Signal types, in filter button order
	var TYPES = [
		{ id: "audio", label: "Audio", cable: "Patch cable" },
		{ id: "power", label: "Power", cable: "Power cable" },
		{ id: "midi", label: "MIDI/USB", cable: "MIDI/USB cable" },
		{ id: "ctrl", label: "CTRL/EXP", cable: "TRS cable" },
	];

	var CONNECTORS = ["TS", "TRS"];
	var VOLTAGES = [5, 9, 12, 15, 18, 24];
	var DEFAULT_VOLTAGE = 9;
	var DEFAULT_CURRENT = 100; // mA a pedal draws
	var DEFAULT_OUTPUT = { v: 9, ma: 500, sw: false };
	var DEFAULT_OUTPUT_COUNT = 8;
	var MAX_OUTPUTS = 16;

	// Pedals recognized as power supplies by name ("Brand Name"). Any pedal can also be
	// switched either way in its options.
	var POWER_SUPPLY_NAMES = [
		/^Cioks /,
		/^Truetone 1 Spot/,
		/^Voodoo Lab (Pedal Power|PX-8)/,
		/^Strymon (Zuma|Ojai)/,
		/^Walrus Audio (Canvas Power|Phoenix)/,
		/^Eventide Power(Max|Mini)/,
		/^Fender Engine Room/,
		/^MXR (DC Brick|Iso Brick|Mini Iso-Brick|CAE Power System)/,
		/^Harley Benton PowerPlant ISO/,
		/^Big Joe .*Power Box/,
		/^Mooer (Macro|Micro) Power/,
		/^Providence Provolt/,
		/^Vertex Battery Supply/,
		/^Surfy Industries SurfyPower/,
		/^One Control .*Distro/,
		/Power Supply/,
	];

	// Y cables and other junctions between jacks
	var JUNCTIONS = {
		split: { name: "Y cable", detail: "TRS to 2× TS" },
		merge: { name: "Y cable", detail: "2× TS to TRS" },
		parallel: { name: "Current doubler", detail: "Parallel Y, 2 outputs" },
		series: { name: "Voltage doubler", detail: "Series, 2 outputs" },
	};

	// Endpoints: gear off the pedalboard where the signal starts or ends, added from the
	// Signal Flow toolbar. Ports are [id, label, type, direction, connector].
	var INTERFACE_CONNECTORS = ["XLR/TRS combo", "XLR", "TRS", "TS", "3.5mm TRS"];
	var MAX_CHANNELS = 32;
	var ICON_ATTRS = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
	var AMP_ICON = '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="7" cy="7" r="0.9" fill="currentColor"/><circle cx="10" cy="7" r="0.9" fill="currentColor"/><circle cx="13" cy="7" r="0.9" fill="currentColor"/><rect x="5.5" y="10" width="13" height="7.5" rx="1"/>';
	var ENDPOINTS = {
		guitar: {
			name: "Guitar",
			icon: '<path d="M13.5 10.5l6.5-6.5"/><path d="M18.5 2.5l3 3"/><path d="M11 8.5c-1.6-1.4-4.2-1-5.1.8-.5 1-.2 1.9-1.2 2.6-1.8 1.2-2 4.2 0 6.4s5.2 1.9 6.4.1c.7-1 1.6-.7 2.6-1.2 1.8-.9 2.2-3.5.8-5.1z"/><circle cx="9" cy="15" r="1.1"/>',
			ports: [["out", "Out", "audio", "out", "TS"]],
		},
		keyboard: {
			name: "Keyboard",
			icon: '<rect x="2" y="6" width="20" height="12" rx="1.5"/><path d="M7 6v12M12 6v12M17 6v12"/><rect x="5.8" y="6" width="2.4" height="6.5" fill="currentColor" stroke="none"/><rect x="10.8" y="6" width="2.4" height="6.5" fill="currentColor" stroke="none"/><rect x="15.8" y="6" width="2.4" height="6.5" fill="currentColor" stroke="none"/>',
			ports: [
				["outl", "Out L/Mono", "audio", "out", "TS"],
				["outr", "Out R", "audio", "out", "TS"],
				["sustain", "Sustain", "ctrl", "in", "TS"],
				["exp", "Expression", "ctrl", "in", "TRS"],
				["midiin", "MIDI In", "midi", "in", "5-pin DIN"],
				["midiout", "MIDI Out", "midi", "out", "5-pin DIN"],
			],
		},
		amp: {
			name: "Guitar Amp",
			icon: AMP_ICON,
			ports: [
				["input", "Input", "audio", "in", "TS"],
				["footswitch", "Footswitch", "ctrl", "in", "TRS"],
			],
		},
		ampLoop: {
			name: "Guitar Amp (FX loop)",
			icon: AMP_ICON.replace(/<rect x="5.5"[^>]*>/, "") + '<path d="M9.5 15a2.8 2.8 0 1 0 2.5-4.2"/><path d="M11 9.3l1.6 1.5-1.6 1.5"/>',
			ports: [
				["input", "Input", "audio", "in", "TS"],
				["return", "FX Return", "audio", "in", "TS"],
				["footswitch", "Footswitch", "ctrl", "in", "TRS"],
				["send", "FX Send", "audio", "out", "TS"],
			],
		},
		// An audio interface (or mixer); its name, channels and jacks are set in its options
		interface: {
			name: "Interface",
			configurable: true,
			icon: '<rect x="2" y="7" width="20" height="10" rx="2"/><circle cx="7" cy="12" r="2.6"/><circle cx="7" cy="12" r="0.9" fill="currentColor"/><circle cx="13" cy="12" r="2.6"/><circle cx="13" cy="12" r="0.9" fill="currentColor"/><path d="M17.5 10.5h2M17.5 13.5h2"/>',
			defaults: { inputs: [{ connector: "XLR/TRS combo" }, { connector: "XLR/TRS combo" }], outputs: [{ connector: "TRS" }, { connector: "TRS" }] },
		},
	};

	function endpointIcon(type) {
		return "<svg " + ICON_ATTRS + ">" + ENDPOINTS[type].icon + "</svg>";
	}

	// nodes: { [itemId]: { x, y, sharedMidiCtrl, powerSupply, voltage, current, connectors, outputs } }
	// connections: [{ from: { node, port }, to: { node, port }, type }] (from = output, to = input)
	// junctions: [{ id, type, mode }] Y cables, drawn as their own small boxes
	// endpoints: [{ id, type, name?, inputs?, outputs? }] guitars, amps, interfaces (keys of
	// ENDPOINTS); an interface lists its channels as { label, connector }
	// hidden: signal type ids switched off with the filter buttons
	var state = load();
	var topZ = 1;
	var openMenu = null;
	var power = { jacks: {}, outputs: {}, warnings: {} };

	// Port specifications from public/data/my-devices.json, by catalog key
	var specs = [];
	$.getJSON("public/data/my-devices.json").done(function (data) {
		specs = (data && data.devices) || [];
		// Redraw Signal Flow and the Parts List with the real ports
		$(document).trigger("playgroundchange");
	});

	// ----------------------------------------------------------------------------------
	// Devices and ports

	// A port lists the signal types its jack carries, with the direction for each
	// ("in", "out" or "both"; power and MIDI jacks on pedals work both ways so pedals
	// can be chained). Some devices use one jack for both MIDI and CTRL/EXP.
	function makePort(id, label, types, directions, extra) {
		return $.extend({ id: id, label: label, types: types, directions: directions, direction: directions[0], connector: null }, extra);
	}

	function directionFor(port, type) {
		return port.directions[port.types.indexOf(type)];
	}

	function allPorts(ports) {
		return ports.inputs.concat(ports.outputs, ports.bottom);
	}

	// Pedal jacks: "inputs" are drawn on the left, "outputs" on the right and "bottom"
	// along the bottom edge. For now every pedal gets the same set, adjusted by its
	// options; eventually this will come from the pedal data.
	function pedalPorts(options) {
		var connectors = options.connectors || {};
		function jack(id, label, type, direction, connector) {
			return makePort(id, label, [type], [direction], { connector: connectors[id] || connector, configurable: true });
		}
		var ports = {
			inputs: [jack("in1", "In 1", "audio", "in", "TS"), jack("in2", "In 2", "audio", "in", "TS"), jack("ctrlin", "CTRL In", "ctrl", "in", "TRS")],
			outputs: [jack("out1", "Out 1", "audio", "out", "TS"), jack("out2", "Out 2", "audio", "out", "TS"), jack("ctrlout", "CTRL Out", "ctrl", "out", "TRS")],
			bottom: [
				makePort("power", "Power", ["power"], ["both"], { voltage: options.voltage || DEFAULT_VOLTAGE, current: options.current || DEFAULT_CURRENT }),
				makePort("midi", "MIDI", ["midi"], ["both"]),
			],
		};
		if (options.sharedMidiCtrl) {
			ports.inputs.splice(2, 1);
			ports.bottom[1] = makePort("midictrl", "MIDI/CTRL", ["midi", "ctrl"], ["both", "in"], { connector: "TRS" });
		}
		return ports;
	}

	function supplyOutputs(options) {
		if (options.outputs && options.outputs.length) return options.outputs;
		var outputs = [];
		for (var i = 0; i < DEFAULT_OUTPUT_COUNT; i++) outputs.push($.extend({}, DEFAULT_OUTPUT));
		return outputs;
	}

	function supplyPorts(options) {
		return {
			inputs: [],
			outputs: supplyOutputs(options).map(function (output, i) {
				return makePort("pwr" + (i + 1), "Out " + (i + 1), ["power"], ["out"], {
					voltage: output.v,
					current: output.ma,
					switchable: !!output.sw,
					index: i,
				});
			}),
			bottom: [],
		};
	}

	// Ports from a device's entry in my-devices.json. Options set in Signal Flow
	// (connectors, power) still apply on top.
	function specPorts(spec, options, supply) {
		var ports = { inputs: [], outputs: [], bottom: [] };
		var connectors = options.connectors || {};
		var outputs = options.outputs || [];
		var outputIndex = 0;
		spec.ports.forEach(function (p) {
			var types = [].concat(p.type);
			var supplyOutput = supply && types[0] === "power" && p.direction === "out";
			// A pedal's power input also links on to the next pedal (daisy chain)
			var directions = types.map(function (type) {
				return type === "power" && p.direction === "in" && !supply ? "both" : p.direction;
			});
			var extra = {
				connector: connectors[p.id] || p.connector || null,
				configurable: types.length === 1 && (types[0] === "audio" || types[0] === "ctrl"),
			};
			if (supplyOutput) {
				// The spec says which outputs have a switch; only those take a saved voltage
				var override = outputs[outputIndex] || {};
				extra.voltageOptions = p.voltageOptions || [];
				extra.switchable = extra.voltageOptions.length > 0;
				extra.voltage = (extra.switchable && extra.voltageOptions.indexOf(override.v) !== -1 && override.v) || p.voltage || DEFAULT_OUTPUT.v;
				// Outputs that derate at higher voltages have their current set by the switch
				extra.currentByVoltage = p.currentByVoltage || null;
				extra.rated = !!(extra.currentByVoltage && extra.currentByVoltage[extra.voltage]);
				extra.fixed = !extra.switchable;
				extra.current = (extra.rated && extra.currentByVoltage[extra.voltage]) || (extra.switchable && override.ma) || p.current || DEFAULT_OUTPUT.ma;
				extra.index = outputIndex++;
			} else if (types[0] === "power") {
				extra.voltage = options.voltage || p.voltage || DEFAULT_VOLTAGE;
				extra.current = options.current || p.current || DEFAULT_CURRENT;
			}
			var side = p.side;
			if (!side) {
				if (supplyOutput) side = "right";
				// Two-way and power jacks on the bottom; one-way MIDI In/Out on the sides
				else if (types[0] === "power" || p.direction === "both") side = "bottom";
				else side = p.direction === "out" ? "right" : "left";
			}
			ports[{ left: "inputs", right: "outputs", bottom: "bottom" }[side]].push(makePort(p.id, p.label, types, directions, extra));
		});
		return ports;
	}

	// The my-devices.json entry for a playground item: matched on the artwork's image
	// file, and on the name when several catalog pedals share an image
	function specFor($item) {
		var image = (($item.find(".artwork").attr("style") || "").match(/\/pedals\/([^)"']+)/) || [])[1];
		if (!image) return null;
		var title = $item.attr("title");
		var matches = specs.filter(function (spec) {
			return spec.key.split("~")[0] === image;
		});
		return (
			matches.filter(function (spec) {
				return spec.brand + " " + spec.name === title;
			})[0] ||
			matches.filter(function (spec) {
				return spec.key.indexOf("~") === -1;
			})[0] ||
			null
		);
	}

	// A pedal's power input (the jack its supply cable and daisy chain plug into)
	function powerJack(device) {
		return allPorts(device.ports).filter(function (port) {
			return port.types[0] === "power" && port.directions[0] === "both";
		})[0];
	}

	// The jack a device draws power through: a pedal's power input, or a supply's own
	// power input when it runs from another supply (an Ojai on a Zuma's 24V output)
	function loadJack(device) {
		if (!device) return null;
		if (device.kind === "pedal") return powerJack(device);
		if (device.kind !== "supply") return null;
		return allPorts(device.ports).filter(function (port) {
			return port.types[0] === "power" && port.directions[0] === "in";
		})[0];
	}

	function junctionPorts(junction) {
		var t = [junction.type];
		var trs = { connector: "TRS", hideConnector: true };
		var ts = { connector: "TS", hideConnector: true };
		if (junction.mode === "split") {
			return {
				inputs: [makePort("trs", "TRS", t, ["in"], trs)],
				outputs: [makePort("tip", "Tip / L", t, ["out"], ts), makePort("ring", "Ring / R", t, ["out"], ts)],
				bottom: [],
			};
		}
		if (junction.mode === "merge") {
			return {
				inputs: [makePort("tip", "Tip / L", t, ["in"], ts), makePort("ring", "Ring / R", t, ["in"], ts)],
				outputs: [makePort("trs", "TRS", t, ["out"], trs)],
				bottom: [],
			};
		}
		// parallel / series power junctions
		return {
			inputs: [makePort("in1", "Output 1", t, ["in"]), makePort("in2", "Output 2", t, ["in"])],
			outputs: [makePort("out", "To pedal", t, ["out"])],
			bottom: [],
		};
	}

	// An interface's channels on one side ("inputs" or "outputs"): [{ label, connector }]
	function channels(endpoint, side) {
		return endpoint[side] || ENDPOINTS[endpoint.type].defaults[side];
	}

	function channelLabel(side, index, channel) {
		return (channel && channel.label) || (side === "inputs" ? "In " : "Out ") + (index + 1);
	}

	function endpointPorts(endpoint) {
		var ports = { inputs: [], outputs: [], bottom: [] };
		if (ENDPOINTS[endpoint.type].configurable) {
			["inputs", "outputs"].forEach(function (side) {
				var direction = side === "inputs" ? "in" : "out";
				channels(endpoint, side).forEach(function (channel, i) {
					ports[side].push(makePort(direction + (i + 1), channelLabel(side, i, channel), ["audio"], [direction], { connector: channel.connector }));
				});
			});
			return ports;
		}
		ENDPOINTS[endpoint.type].ports.forEach(function (p) {
			ports[p[3] === "out" ? "outputs" : "inputs"].push(makePort(p[0], p[1], [p[2]], [p[3]], { connector: p[4] }));
		});
		return ports;
	}

	// "Guitar", then "Guitar 2", "Guitar 3"... when there are several of one kind
	function endpointName(endpoint) {
		if (endpoint.name) return endpoint.name;
		var same = state.endpoints.filter(function (other) {
			return other.type === endpoint.type;
		});
		var name = ENDPOINTS[endpoint.type].name;
		return same.length > 1 ? name + " " + (same.indexOf(endpoint) + 1) : name;
	}

	function typeInfo(id) {
		return TYPES.filter(function (type) {
			return type.id === id;
		})[0] || TYPES[0];
	}

	function findPort(ports, id) {
		return allPorts(ports).filter(function (port) {
			return port.id === id;
		})[0];
	}

	function isHidden(type) {
		return state.hidden.indexOf(type) !== -1;
	}

	// A port is hidden only when every type its jack carries is hidden
	function isPortHidden(port) {
		return port.types.every(isHidden);
	}

	// Set in the pedal's options, else the subcategory in my-devices.json, else by name
	function isPowerSupply(id, name, spec) {
		var options = state.nodes[id] || {};
		if (typeof options.powerSupply === "boolean") return options.powerSupply;
		if (spec) return spec.subcategory === "Power Supply";
		return POWER_SUPPLY_NAMES.some(function (pattern) {
			return pattern.test(name);
		});
	}

	function deviceFor($item) {
		var id = $item.attr("id");
		var name = $item.attr("title") || "Custom Pedal";
		var options = state.nodes[id] || {};
		var spec = specFor($item);
		var supply = isPowerSupply(id, name, spec);
		// The spec's ports only fit when it agrees on being a power supply
		var useSpec = spec && (spec.subcategory === "Power Supply") === supply;
		return {
			id: id,
			name: name,
			kind: supply ? "supply" : "pedal",
			spec: useSpec ? spec : null,
			ports: useSpec ? specPorts(spec, options, supply) : supply ? supplyPorts(options) : pedalPorts(options),
		};
	}

	function getDevices() {
		var devices = $(".canvas .item.pedal")
			.map(function () {
				return deviceFor($(this));
			})
			.get();
		state.junctions.forEach(function (junction) {
			devices.push({
				id: junction.id,
				name: JUNCTIONS[junction.mode].name,
				kind: "junction",
				junction: junction,
				ports: junctionPorts(junction),
			});
		});
		state.endpoints.forEach(function (endpoint) {
			if (!ENDPOINTS[endpoint.type]) return;
			devices.push({
				id: endpoint.id,
				name: endpointName(endpoint),
				kind: "endpoint",
				endpoint: endpoint,
				ports: endpointPorts(endpoint),
			});
		});
		return devices;
	}

	function devicesById(devices) {
		var byId = {};
		devices.forEach(function (device) {
			byId[device.id] = device;
		});
		return byId;
	}

	// ----------------------------------------------------------------------------------
	// State

	function emptyState() {
		return { nodes: {}, connections: [], junctions: [], endpoints: [], hidden: [], lengths: {} };
	}

	// The earlier fixed XLR/TS/TRS interfaces become a configurable interface with two
	// inputs of that type (jack ids stay "in1", "in2", so their cables are kept)
	// (state is loaded before the variables below are set, so the table is kept in here)
	function migrateEndpoint(endpoint) {
		var connector = endpoint && { interfaceXlr: "XLR", interfaceTs: "TS", interfaceTrs: "TRS" }[endpoint.type];
		if (!connector) return endpoint;
		return { id: endpoint.id, type: "interface", inputs: [{ connector: connector }, { connector: connector }], outputs: [] };
	}

	function normalize(saved) {
		if (!saved || typeof saved !== "object") return emptyState();
		return {
			nodes: saved.nodes && typeof saved.nodes === "object" ? saved.nodes : {},
			connections: Array.isArray(saved.connections) ? saved.connections : [],
			junctions: Array.isArray(saved.junctions) ? saved.junctions : [],
			endpoints: Array.isArray(saved.endpoints) ? saved.endpoints.map(migrateEndpoint) : [],
			hidden: Array.isArray(saved.hidden) ? saved.hidden : [],
			// Cable lengths typed into the Parts List, by cable (or Y cable) id
			lengths: saved.lengths && typeof saved.lengths === "object" ? saved.lengths : {},
		};
	}

	function load() {
		try {
			return normalize(JSON.parse(localStorage[STORAGE_KEY] || "null"));
		} catch (e) {
			return emptyState();
		}
	}

	function save() {
		try {
			localStorage[STORAGE_KEY] = JSON.stringify(state);
		} catch (e) {}
	}

	// Drop boxes and connections for pedals (or jacks) that are no longer there, and give
	// connections saved before cables had a signal type the type of their output jack
	function prune(devices) {
		var byId = devicesById(devices);
		Object.keys(state.nodes).forEach(function (id) {
			if (!byId[id]) delete state.nodes[id];
		});
		state.connections = state.connections.filter(function (c) {
			var from = byId[c.from.node] && findPort(byId[c.from.node].ports, c.from.port);
			var to = byId[c.to.node] && findPort(byId[c.to.node].ports, c.to.port);
			if (!from || !to) return false;
			if (!c.type) c.type = from.types[0];
			if (!c.id) c.id = newId("cable");
			return true;
		});
		// A Y cable with nothing plugged into it (its pedals were removed) goes too
		var junctionCount = state.junctions.length;
		state.junctions = state.junctions.filter(function (junction) {
			var used = state.connections.some(function (c) {
				return c.from.node === junction.id || c.to.node === junction.id;
			});
			if (!used) delete state.nodes[junction.id];
			return used;
		});
		var ids = {};
		state.connections.concat(state.junctions).forEach(function (item) {
			ids[item.id] = true;
		});
		Object.keys(state.lengths).forEach(function (id) {
			if (!ids[id]) delete state.lengths[id];
		});
		// Tells the caller its device list now has a Y cable too many
		return state.junctions.length !== junctionCount;
	}

	// Switch a pedal between separate CTRL In and MIDI jacks and one shared MIDI/CTRL
	// jack, moving its cables over. A jack holds one kind of cable at a time, so when
	// both kinds were plugged in, the MIDI cables are kept.
	function setSharedMidiCtrl(id, shared) {
		state.nodes[id].sharedMidiCtrl = shared;
		var onNode = function (end) {
			return end.node === id;
		};
		if (shared) {
			var hasMidi = state.connections.some(function (c) {
				return (onNode(c.from) && c.from.port === "midi") || (onNode(c.to) && c.to.port === "midi");
			});
			state.connections = state.connections.filter(function (c) {
				return !(hasMidi && onNode(c.to) && c.to.port === "ctrlin");
			});
			state.connections.forEach(function (c) {
				[c.from, c.to].forEach(function (end) {
					if (onNode(end) && (end.port === "midi" || end.port === "ctrlin")) end.port = "midictrl";
				});
			});
		} else {
			state.connections.forEach(function (c) {
				[c.from, c.to].forEach(function (end) {
					if (onNode(end) && end.port === "midictrl") end.port = c.type === "ctrl" ? "ctrlin" : "midi";
				});
			});
		}
		render();
	}

	// Roughly how tall a device's box will be, from its rows of ports
	function estimateHeight(device) {
		var rows = Math.max(device.ports.inputs.length, device.ports.outputs.length);
		return 40 + rows * 23 + (device.ports.bottom.length ? 45 : 0);
	}

	// Boxes widen to give each jack on the bottom edge room for its label
	var BOTTOM_PORT_WIDTH = 68;
	function boxWidth(device) {
		if (device.kind === "junction") return JUNCTION_WIDTH;
		// Room for the icon, the name and the remove button
		if (device.kind === "endpoint") return Math.max(NODE_WIDTH, 64 + device.name.length * 7.5);
		var bottom = device.ports.bottom.filter(function (port) {
			return !isPortHidden(port);
		}).length;
		// and side jacks with long names ("Balanced Out L XLR") get room to stay on one line
		var sides = sideWidth(device.ports.inputs) + sideWidth(device.ports.outputs) + 50;
		return Math.round(Math.max(NODE_WIDTH, bottom * BOTTOM_PORT_WIDTH, Math.min(MAX_NODE_WIDTH, sides)));
	}

	// Rough width of the widest jack label on one side: the name, plus the connector or
	// power badge in its smaller type
	var MAX_NODE_WIDTH = 360;
	function sideWidth(ports) {
		return ports.reduce(function (widest, port) {
			if (isPortHidden(port)) return widest;
			var badge = port.voltage ? port.voltage + "V · " + port.current + " mA" : port.hideConnector ? "" : port.connector || "";
			return Math.max(widest, port.label.length * 6.5 + badge.length * 5.5 + 10);
		}, 0);
	}

	// First grid slot where a box of this size doesn't overlap another box. Boxes
	// already drawn are measured, so a tall power supply blocks the slots below it
	// and a wide box the slot beside it.
	function nextFreeSpot(height, width) {
		var columns = Math.max(1, Math.floor(($(".signal-flow").width() - 40) / (NODE_WIDTH + NODE_GAP_X)));
		var taken = Object.keys(state.nodes).map(function (id) {
			var pos = state.nodes[id];
			var $box = $('.flow-node[data-id="' + id + '"]');
			return { x: pos.x, y: pos.y, width: $box.outerWidth() || NODE_WIDTH, height: $box.outerHeight() || NODE_HEIGHT_ESTIMATE };
		});
		for (var slot = 0; ; slot++) {
			var x = 40 + (slot % columns) * (NODE_WIDTH + NODE_GAP_X);
			var y = 40 + Math.floor(slot / columns) * (NODE_HEIGHT_ESTIMATE + NODE_GAP_Y);
			var occupied = taken.some(function (box) {
				return (
					x < box.x + box.width + NODE_GAP_X / 2 &&
					box.x < x + width + NODE_GAP_X / 2 &&
					y < box.y + box.height + NODE_GAP_Y / 2 &&
					box.y < y + height + NODE_GAP_Y / 2
				);
			});
			if (!occupied) return { x: x, y: y };
		}
	}

	// ----------------------------------------------------------------------------------
	// Power
	// Pedal power jacks cabled to each other form a chain fed by a supply output (or a
	// series/parallel junction). Each chain gets the source's voltage and shares its
	// current limit.

	var idCounter = 0;
	function newId(prefix) {
		return prefix + "-" + Date.now().toString(36) + (idCounter++).toString(36);
	}

	function portKey(node, port) {
		return node + ":" + port;
	}

	function analyzePower(devices, connections) {
		var byId = devicesById(devices);
		var report = { jacks: {}, outputs: {}, warnings: {} };
		var powerCables = connections.filter(function (c) {
			return c.type === "power";
		});
		function kindOf(end) {
			return byId[end.node] ? byId[end.node].kind : null;
		}
		function portOf(end) {
			return byId[end.node] && findPort(byId[end.node].ports, end.port);
		}
		function endLabel(end) {
			return byId[end.node].name + " " + portOf(end).label;
		}

		// Chains: pedal power jacks joined by pedal-to-pedal cables
		var parent = {};
		function find(key) {
			while (parent[key] && parent[key] !== key) key = parent[key];
			return key;
		}
		devices.forEach(function (device) {
			var jack = loadJack(device);
			if (jack) parent[portKey(device.id, jack.id)] = portKey(device.id, jack.id);
		});
		powerCables.forEach(function (c) {
			if (kindOf(c.from) === "pedal" && kindOf(c.to) === "pedal") {
				parent[find(portKey(c.from.node, c.from.port))] = find(portKey(c.to.node, c.to.port));
			}
		});

		// What a supply output or junction output provides
		function sourceOf(end, depth) {
			var port = portOf(end);
			if (kindOf(end) === "supply") {
				return { voltage: port.voltage, current: port.current, label: endLabel(end), outputs: [{ end: end, share: 1 }] };
			}
			if (kindOf(end) !== "junction" || depth > 4) return null;
			var mode = byId[end.node].junction.mode;
			var feeds = ["in1", "in2"].map(function (input) {
				var cable = powerCables.filter(function (c) {
					return c.to.node === end.node && c.to.port === input;
				})[0];
				return cable ? sourceOf(cable.from, depth + 1) : null;
			});
			var both = feeds[0] && feeds[1];
			var label = JUNCTIONS[mode].name;
			if (mode === "series") {
				if (!both) return { voltage: 0, current: 0, label: label, problem: "Plug both legs of the voltage doubler into supply outputs", outputs: [] };
				return {
					voltage: feeds[0].voltage + feeds[1].voltage,
					current: Math.min(feeds[0].current, feeds[1].current),
					label: label + " (" + feeds[0].label + " + " + feeds[1].label + ")",
					outputs: feeds[0].outputs.concat(feeds[1].outputs),
				};
			}
			// parallel: same voltage, currents add
			var present = feeds.filter(Boolean);
			if (!present.length) return null;
			if (both && feeds[0].voltage !== feeds[1].voltage) {
				return { voltage: feeds[0].voltage, current: 0, label: label, problem: "The current doubler's outputs are set to different voltages", outputs: [] };
			}
			return {
				voltage: present[0].voltage,
				current: present.reduce(function (sum, feed) {
					return sum + feed.current;
				}, 0),
				label: label + " (" + present.map(function (feed) {
					return feed.label;
				}).join(" + ") + ")",
				outputs: present.reduce(function (all, feed) {
					return all.concat(feed.outputs.map(function (output) {
						return { end: output.end, share: output.share / present.length };
					}));
				}, []),
			};
		}

		// Sources and loads per chain
		var chains = {};
		Object.keys(parent).forEach(function (key) {
			var root = find(key);
			var chain = chains[root] || (chains[root] = { jacks: [], sources: [], cables: [] });
			chain.jacks.push(key);
		});
		function isLoad(end) {
			var jack = loadJack(byId[end.node]);
			return !!jack && jack.id === end.port;
		}
		powerCables.forEach(function (c, index) {
			var pedalEnd = isLoad(c.to) ? c.to : isLoad(c.from) ? c.from : null;
			if (!pedalEnd) return;
			var chain = chains[find(portKey(pedalEnd.node, pedalEnd.port))];
			chain.cables.push(c);
			var other = pedalEnd === c.to ? c.from : c.to;
			if (kindOf(other) !== "pedal") {
				var source = sourceOf(other, 0);
				if (source) chain.sources.push(source);
			}
		});

		Object.keys(chains).forEach(function (root) {
			var chain = chains[root];
			var load = chain.jacks.reduce(function (sum, key) {
				var parts = key.split(":");
				return sum + portOf({ node: parts[0], port: parts[1] }).current;
			}, 0);
			var source = chain.sources[0];
			var chainProblem = null;
			if (chain.sources.length > 1) chainProblem = "Fed by more than one supply output";
			else if (source && source.problem) chainProblem = source.problem;
			// A wrong voltage matters more than an overload, so it's reported first
			var overload = source && load > source.current ? "Draws " + load + " mA, more than the " + source.current + " mA available" : null;

			chain.jacks.forEach(function (key) {
				var parts = key.split(":");
				var jack = portOf({ node: parts[0], port: parts[1] });
				var info = { needs: jack.voltage, draws: jack.current, load: load, source: source || null, problem: chainProblem };
				if (!info.problem && source && source.voltage !== jack.voltage) {
					info.problem = "Needs " + jack.voltage + "V, gets " + source.voltage + "V";
				}
				info.problem = info.problem || overload;
				info.text = !source
					? "Needs " + jack.voltage + "V, " + jack.current + " mA. Not powered."
					: "Needs " + jack.voltage + "V, " + jack.current + " mA. Gets " + source.voltage + "V from " + source.label + " (chain draws " + load + " of " + source.current + " mA)" + (info.problem ? ". " + info.problem + "." : ".");
				report.jacks[key] = info;
				if (info.problem) {
					chain.cables.forEach(function (c) {
						report.warnings[connections.indexOf(c)] = true;
					});
				}
			});

			if (source) {
				source.outputs.forEach(function (output) {
					var key = portKey(output.end.node, output.end.port);
					var entry = report.outputs[key] || (report.outputs[key] = { load: 0, current: portOf(output.end).current });
					entry.load += load * output.share;
				});
			}
		});

		Object.keys(report.outputs).forEach(function (key) {
			var entry = report.outputs[key];
			entry.load = Math.round(entry.load);
			entry.over = entry.load > entry.current;
		});
		return report;
	}

	// ----------------------------------------------------------------------------------
	// Rendering

	function isVisible() {
		return !$(".signal-flow").hasClass("hide");
	}

	function render() {
		var devices = getDevices();
		if (prune(devices)) devices = getDevices();
		power = analyzePower(devices, state.connections);

		var $nodes = $(".signal-flow__nodes").empty();
		devices.forEach(function (device) {
			var pos = state.nodes[device.id] || (state.nodes[device.id] = nextFreeSpot(estimateHeight(device), boxWidth(device)));
			// A junction carries a single signal type, so it hides with that type
			if (device.kind === "junction" && isHidden(device.junction.type)) return;
			$nodes.append(renderNode(device, pos));
		});

		renderFilters();
		$(".signal-flow__empty").toggle(devices.length === 0);
		resizeSurface();
		drawWires();
		placeOptions();
		save();
	}

	function renderNode(device, pos) {
		var $node = $('<div class="flow-node">')
			.addClass("flow-node--" + device.kind)
			.attr("data-id", device.id)
			.css({ left: pos.x, top: pos.y, width: boxWidth(device) })
			.toggleClass("is-menu-open", openMenu === device.id);
		if (openMenu === device.id) $node.css("z-index", ++topZ);

		var $name = $('<div class="flow-node__name">').text(device.name).attr("title", device.name).appendTo($node);

		if (device.kind === "junction") {
			$name.attr("title", device.name + " (" + JUNCTIONS[device.junction.mode].detail + ")");
			$('<small class="flow-node__detail">').text(JUNCTIONS[device.junction.mode].detail).appendTo($name);
			$('<button type="button" class="flow-node__remove" title="Remove this cable" aria-label="Remove this cable">&times;</button>').appendTo($node);
		} else if (device.kind === "endpoint") {
			$name.empty().append(
				$('<span class="flow-node__icon">').html(endpointIcon(device.endpoint.type)),
				$('<span class="flow-node__title">').text(device.name)
			);
			$('<button type="button" class="flow-node__remove">&times;</button>')
				.attr({ title: "Remove " + device.name, "aria-label": "Remove " + device.name })
				.appendTo($node);
			if (ENDPOINTS[device.endpoint.type].configurable) {
				$node.addClass("flow-node--configurable");
				$('<button type="button" class="flow-node__menu-btn" title="Options" aria-label="Options">')
					.attr("aria-expanded", openMenu === device.id)
					.append('<span class="glyphicon glyphicon-cog" aria-hidden="true"></span>')
					.appendTo($node);
				renderEndpointOptions(device).appendTo($node);
			}
		} else {
			$('<button type="button" class="flow-node__menu-btn" title="Options" aria-label="Options">')
				.attr("aria-expanded", openMenu === device.id)
				.append('<span class="glyphicon glyphicon-cog" aria-hidden="true"></span>')
				.appendTo($node);
			renderOptions(device, pos).appendTo($node);
		}

		// Side jacks are drawn in rows, inputs left and outputs right: audio/CTRL jacks
		// first, then MIDI. The shorter side gets blank rows so MIDI In and MIDI Out line
		// up. Ports of hidden signal types are left out, so the box shrinks.
		var $ports = $('<div class="flow-node__ports">').appendTo($node);
		function shown(ports) {
			return ports.filter(function (port) {
				return !isPortHidden(port);
			});
		}
		// MIDI-only jacks; a combined MIDI/EXP jack stays with the CTRL jacks
		function isMidi(port) {
			return port.types.length === 1 && port.types[0] === "midi";
		}
		function not(test) {
			return function (port) {
				return !test(port);
			};
		}
		var inputs = shown(device.ports.inputs);
		var outputs = shown(device.ports.outputs);
		[not(isMidi), isMidi].forEach(function (group) {
			var left = inputs.filter(group);
			var right = outputs.filter(group);
			for (var i = 0; i < Math.max(left.length, right.length); i++) {
				$('<div class="flow-row">')
					.append(
						$('<div class="flow-row__in">').append(left[i] ? renderPort(device, left[i], "in") : null),
						$('<div class="flow-row__out">').append(right[i] ? renderPort(device, right[i], "out") : null)
					)
					.appendTo($ports);
			}
		});
		var $bottom = $('<div class="flow-node__bottom">');
		device.ports.bottom.forEach(function (port) {
			if (!isPortHidden(port)) $bottom.append(renderPort(device, port, "bottom"));
		});
		if ($bottom.children().length) $node.append($bottom);

		return $node;
	}

	function voltageSelect(value, attrs, choices) {
		var $select = $('<select class="flow-option input-sm">').attr(attrs);
		choices = choices || VOLTAGES;
		var voltages = choices.indexOf(value) === -1 ? choices.concat(value) : choices;
		voltages.forEach(function (v) {
			$("<option>").val(v).text(v + "V").prop("selected", v === value).appendTo($select);
		});
		return $select;
	}

	function numberInput(value, attrs) {
		return $('<input type="number" class="flow-option input-sm" min="0" step="10">').val(value).attr(attrs);
	}

	function checkbox(label, checked, attrs, className) {
		return $("<label>").append(
			$('<input type="checkbox" class="flow-option">').addClass(className || "").prop("checked", checked).attr(attrs),
			" " + label
		);
	}

	// An interface's options: its name, and the name and jack of each input and output.
	// Names update as you type (see the "input" handler) so the box keeps focus.
	function renderEndpointOptions(device) {
		var endpoint = device.endpoint;
		var $options = $('<div class="flow-node__options flow-node__options--endpoint">');
		$('<div class="flow-option-row">')
			.append("<span>Name</span>", $('<input type="text" class="flow-text input-sm">').attr({ "data-field": "name", placeholder: ENDPOINTS[endpoint.type].name, "aria-label": "Device name" }).val(endpoint.name || ""))
			.appendTo($options);
		["inputs", "outputs"].forEach(function (side) {
			var list = channels(endpoint, side);
			$('<div class="flow-option-row flow-option-title">')
				.append(
					$("<span>").text(side === "inputs" ? "Inputs" : "Outputs"),
					$('<input type="number" class="flow-option input-sm" min="0">').attr({ max: MAX_CHANNELS, "data-option": "channelCount", "data-side": side, "aria-label": "Number of " + side }).val(list.length)
				)
				.appendTo($options);
			list.forEach(function (channel, i) {
				var $connector = $('<select class="flow-option input-sm">').attr({ "data-option": "channelConnector", "data-side": side, "data-index": i, "aria-label": channelLabel(side, i) + " jack" });
				var choices = INTERFACE_CONNECTORS.indexOf(channel.connector) === -1 ? INTERFACE_CONNECTORS.concat(channel.connector) : INTERFACE_CONNECTORS;
				choices.forEach(function (connector) {
					$("<option>").val(connector).text(connector).prop("selected", connector === channel.connector).appendTo($connector);
				});
				$('<div class="flow-option-row">')
					.append(
						$('<input type="text" class="flow-text input-sm">').attr({ "data-field": "label", "data-side": side, "data-index": i, placeholder: channelLabel(side, i), "aria-label": channelLabel(side, i) + " name" }).val(channel.label || ""),
						$connector
					)
					.appendTo($options);
			});
		});
		return $options;
	}

	// Copy an interface's channel lists so they can be changed and saved on the endpoint
	function editableChannels(endpoint) {
		["inputs", "outputs"].forEach(function (side) {
			endpoint[side] = channels(endpoint, side).map(function (channel) {
				return $.extend({}, channel);
			});
		});
	}

	function endpointById(id) {
		return state.endpoints.filter(function (endpoint) {
			return endpoint.id === id;
		})[0];
	}

	// The options menu behind a box's cog button
	function renderOptions(device, options) {
		var $options = $('<div class="flow-node__options">');
		if (device.spec) {
			$('<div class="flow-option-note">')
				.text("Ports from my-devices.json (" + device.spec.subcategory + (device.spec.verified ? "" : ", not verified yet") + ")")
				.appendTo($options);
		}
		$options.append(checkbox("Power supply", device.kind === "supply", { "data-option": "powerSupply" }));

		if (device.kind === "supply") {
			// A supply from my-devices.json has its outputs listed there
			if (!device.spec) {
				$('<div class="flow-option-row">')
					.append("<span>Outputs</span>", $('<input type="number" class="flow-option input-sm" min="1">').attr({ max: MAX_OUTPUTS, "data-option": "outputCount" }).val(device.ports.outputs.length))
					.appendTo($options);
			}
			$('<div class="flow-option-title">').text("Voltage, current and switch per output").appendTo($options);
			supplyOutputPorts(device).forEach(function (port) {
				$('<div class="flow-option-row">')
					.append(
						$("<span>").text(port.label),
						voltageSelect(port.voltage, { "data-option": "outputVoltage", "data-index": port.index, title: port.fixed ? "Fixed output (from my-devices.json)" : "Voltage" }, port.voltageOptions && port.voltageOptions.length ? port.voltageOptions : null).prop("disabled", !!port.fixed),
						numberInput(port.current, { "data-option": "outputCurrent", "data-index": port.index, title: port.rated || port.fixed ? "Current from my-devices.json" : "Current (mA)" }).prop("disabled", !!(port.rated || port.fixed)),
						"<span>mA</span>",
						// Outputs from my-devices.json have their switch set there
						device.spec ? null : checkbox("Switch", port.switchable, { "data-option": "outputSwitch", "data-index": port.index, title: "This output has a voltage switch" })
					)
					.appendTo($options);
			});
			return $options;
		}

		// The shared MIDI/CTRL option only applies to the generic jacks
		if (!device.spec) {
			$options.append(checkbox("MIDI and CTRL share one jack", !!options.sharedMidiCtrl, { "data-option": "sharedMidiCtrl" }, "flow-node__shared-midi-ctrl"));
		}
		var jack = powerJack(device);
		if (jack) {
			$('<div class="flow-option-row">')
				.append(
					"<span>Power</span>",
					voltageSelect(jack.voltage, { "data-option": "voltage", title: "Voltage" }),
					numberInput(jack.current, { "data-option": "current", title: "Current draw (mA)" }),
					"<span>mA</span>"
				)
				.appendTo($options);
		}
		$('<div class="flow-option-title">').text("Jacks").appendTo($options);
		allPorts(device.ports).forEach(function (port) {
			if (!port.configurable) return;
			var $select = $('<select class="flow-option input-sm">').attr({ "data-option": "connector", "data-jack": port.id });
			CONNECTORS.forEach(function (connector) {
				$("<option>").val(connector).text(connector === "TS" ? "TS (mono)" : "TRS (stereo)").prop("selected", connector === port.connector).appendTo($select);
			});
			$('<div class="flow-option-row">').append($("<span>").text(port.label), $select).appendTo($options);
		});
		return $options;
	}

	// side is where the port is drawn: "in" (left), "out" (right) or "bottom".
	// A jack carrying two signal types gets both colors.
	function renderPort(device, port, side) {
		var $port = $('<div class="flow-port">')
			.addClass("flow-port--" + side + " flow-type--" + port.types[0])
			.attr({
				"data-port": port.id,
				"data-direction": port.directions.join(" "),
				"data-side": side,
				"data-type": port.types.join(" "),
				"data-connector": port.connector || "",
			});
		if (port.types.length > 1) $port.addClass("flow-port--multi flow-type2--" + port.types[1]);
		var $label = $('<span class="flow-port__label">').text(port.label).attr("title", port.label + (port.connector ? " (" + port.connector + ")" : ""));
		var key = portKey(device.id, port.id);
		var badge = port.voltage ? port.voltage + "V · " + port.current + " mA" : port.hideConnector ? "" : port.connector;
		// Supply outputs show how much of their current is used: "9V · 100/500 mA"
		if (device.kind === "supply" && port.index !== undefined) {
			badge = port.voltage + "V · " + (power.outputs[key] ? power.outputs[key].load : 0) + "/" + port.current + " mA";
		}
		var $badge = badge ? $('<small class="flow-port__connector">').text(badge).attr("title", badge) : null;
		// A switchable output gets its voltage switch right on the jack
		if (device.kind === "supply" && port.switchable && port.index !== undefined) {
			var ratings = switchVoltages(port)
				.map(function (v) {
					return v + "V " + currentAt(port, v) + " mA";
				})
				.join(", ");
			var $switch = voltageSelect(port.voltage, { "data-option": "outputVoltage", "data-index": port.index, title: port.label + " voltage switch" + (port.currentByVoltage ? ": " + ratings : "") }, switchVoltages(port)).addClass("flow-port__switch");
			$badge.text(badge.replace(/^\d+V · /, "")).attr("title", badge).prepend($switch, " ");
		}
		if ($badge) $label.append($badge);

		// Power status: what a pedal gets, how much of an output is used
		if (power.jacks[key]) {
			$port.attr("title", power.jacks[key].text).toggleClass("is-power-problem", !!power.jacks[key].problem);
		} else if (device.kind === "supply") {
			var use = power.outputs[key];
			$port
				.attr("title", port.voltage + "V, " + port.current + " mA" + (port.switchable ? " (voltage switch)" : "") + (use ? ". Used " + use.load + " mA" : ". Unused"))
				.toggleClass("is-power-problem", !!(use && use.over));
		}

		var $dot = $('<span class="flow-port__dot">');
		return side === "in" ? $port.append($dot, $label) : $port.append($label, $dot);
	}

	function renderFilters() {
		var $filters = $(".signal-flow__filters").empty();
		TYPES.forEach(function (type) {
			var shown = !isHidden(type.id);
			$('<button type="button" class="flow-filter">')
				.addClass("flow-type--" + type.id)
				.toggleClass("is-off", !shown)
				.attr({ "data-type": type.id, "aria-pressed": shown, title: (shown ? "Hide " : "Show ") + type.label + " connections" })
				.append('<span class="flow-filter__swatch"></span>', $("<span>").text(type.label))
				.appendTo($filters);
		});

		// Menu for adding guitars, amps and interfaces
		var $menu = $('<ul class="dropdown-menu flow-add__menu">');
		Object.keys(ENDPOINTS).forEach(function (type) {
			$("<li>")
				.append($('<a href="#" class="flow-add__item">').attr("data-endpoint", type).append(endpointIcon(type), $("<span>").text(ENDPOINTS[type].name)))
				.appendTo($menu);
		});
		$('<div class="dropdown flow-add">')
			.append(
				$('<button type="button" class="flow-add__btn dropdown-toggle" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false">').append(
					'<span class="glyphicon glyphicon-plus" aria-hidden="true"></span>',
					"<span>Add endpoint</span>"
				),
				$menu
			)
			.appendTo($filters);

		$('<button type="button" class="flow-tool flow-tool--optimize" title="Arrange the boxes in signal order with as few crossing cables as possible">')
			.append('<span class="glyphicon glyphicon-th-large" aria-hidden="true"></span>', "<span>Optimize layout</span>")
			.appendTo($filters);
		if (undoLayout) {
			$('<button type="button" class="flow-tool flow-tool--undo" title="Put the boxes back where they were">')
				.append('<span class="glyphicon glyphicon-share-alt flip-x" aria-hidden="true"></span>', "<span>Undo</span>")
				.appendTo($filters);
		}
	}

	// ----------------------------------------------------------------------------------
	// Optimize layout
	// Boxes on the signal path go in columns, left to right in signal order (guitar,
	// pedals, amp), each column ordered to keep cables from crossing and centred on the
	// tallest one. Power supplies and power cables go in a row below, then anything not
	// cabled. The previous positions are kept for one undo.

	var LAYOUT_MARGIN = 40;
	var LAYOUT_GAP_X = 80;
	var LAYOUT_GAP_Y = 30;
	var undoLayout = null;

	function isPowerNode(device) {
		return device.kind === "supply" || (device.kind === "junction" && device.junction.type === "power");
	}

	function optimizeLayout() {
		var devices = getDevices();
		if (prune(devices)) devices = getDevices();
		var byId = devicesById(devices);
		function size(device) {
			return { width: boxWidth(device), height: $('.flow-node[data-id="' + device.id + '"]').outerHeight() || estimateHeight(device) };
		}

		// Signal cables between boxes on the signal path
		var next = {};
		var prev = {};
		var linked = {};
		state.connections.forEach(function (c) {
			var from = byId[c.from.node];
			var to = byId[c.to.node];
			if (c.type === "power" || !from || !to || from === to || isPowerNode(from) || isPowerNode(to)) return;
			// An FX loop's way back into the amp; its pedals follow the amp's FX Send
			if (to.kind === "endpoint" && c.to.port === "return") return;
			(next[from.id] = next[from.id] || []).push(to.id);
			(prev[to.id] = prev[to.id] || []).push(from.id);
			linked[from.id] = linked[to.id] = true;
		});
		var ids = devices
			.filter(function (device) {
				return linked[device.id];
			})
			.map(function (device) {
				return device.id;
			});

		// Drop the cables that loop back (an amp's FX loop returns to the amp), starting
		// from boxes nothing feeds, so the rest run strictly left to right
		var starts = ids.filter(function (id) {
			return !prev[id];
		});
		var color = {};
		var forward = [];
		function visit(id) {
			color[id] = 1;
			(next[id] || []).forEach(function (to) {
				if (color[to] === 1) return;
				forward.push([id, to]);
				if (!color[to]) visit(to);
			});
			color[id] = 2;
		}
		starts.concat(ids).forEach(function (id) {
			if (!color[id]) visit(id);
		});

		// Column: the longest run of cables leading to the box
		var column = {};
		var waiting = {};
		ids.forEach(function (id) {
			column[id] = 0;
			waiting[id] = 0;
		});
		forward.forEach(function (edge) {
			waiting[edge[1]]++;
		});
		var queue = ids.filter(function (id) {
			return !waiting[id];
		});
		var topological = [];
		while (queue.length) {
			var id = queue.shift();
			topological.push(id);
			forward.forEach(function (edge) {
				if (edge[0] !== id) return;
				column[edge[1]] = Math.max(column[edge[1]], column[id] + 1);
				if (--waiting[edge[1]] === 0) queue.push(edge[1]);
			});
		}
		// Boxes nothing feeds (a MIDI controller) move up next to what they feed
		topological.reverse().forEach(function (id) {
			var targets = forward.filter(function (edge) {
				return edge[0] === id;
			});
			if (prev[id] || !targets.length) return;
			column[id] = Math.min.apply(null, targets.map(function (edge) {
				return column[edge[1]];
			})) - 1;
		});

		var columns = [];
		ids.forEach(function (id) {
			(columns[column[id]] = columns[column[id]] || []).push(id);
		});
		columns = columns.filter(Boolean);

		// Order each column by the average position of the boxes it's cabled to, sweeping
		// right then left a few times
		var rank = {};
		function rerank() {
			columns.forEach(function (list) {
				list.forEach(function (id, i) {
					rank[id] = i / Math.max(1, list.length - 1);
				});
			});
		}
		function sortBy(neighbors) {
			return function (list) {
				var key = {};
				list.forEach(function (id) {
					var near = (neighbors[id] || []).filter(function (other) {
						return rank[other] !== undefined;
					});
					key[id] = near.length
						? near.reduce(function (sum, other) {
								return sum + rank[other];
						  }, 0) / near.length
						: rank[id];
				});
				list.sort(function (a, b) {
					return key[a] - key[b];
				});
				rerank();
			};
		}
		rerank();
		for (var sweep = 0; sweep < 4; sweep++) {
			columns.forEach(sortBy(prev));
			columns.slice().reverse().forEach(sortBy(next));
		}

		// Positions
		var previous = {};
		Object.keys(state.nodes).forEach(function (id) {
			previous[id] = { x: state.nodes[id].x, y: state.nodes[id].y };
		});
		function place(id, x, y) {
			state.nodes[id] = $.extend(state.nodes[id] || {}, { x: Math.round(x), y: Math.round(y) });
		}
		var heights = columns.map(function (list) {
			return list.reduce(function (sum, id) {
				return sum + size(byId[id]).height + LAYOUT_GAP_Y;
			}, -LAYOUT_GAP_Y);
		});
		var tallest = Math.max.apply(null, [0].concat(heights));
		var x = LAYOUT_MARGIN;
		columns.forEach(function (list, i) {
			var width = Math.max.apply(null, list.map(function (id) {
				return size(byId[id]).width;
			}));
			var y = LAYOUT_MARGIN + (tallest - heights[i]) / 2;
			list.forEach(function (id) {
				// Narrower boxes are centred in their column
				place(id, x + (width - size(byId[id]).width) / 2, y);
				y += size(byId[id]).height + LAYOUT_GAP_Y;
			});
			x += width + LAYOUT_GAP_X;
		});

		// Rows below: power, then boxes with no signal cables
		var right = Math.max(x - LAYOUT_GAP_X, $(".signal-flow").width() - LAYOUT_MARGIN);
		var top = columns.length ? LAYOUT_MARGIN + tallest + LAYOUT_GAP_Y * 2 : LAYOUT_MARGIN;
		function placeRow(list) {
			var rowX = LAYOUT_MARGIN;
			var rowHeight = 0;
			list.forEach(function (device) {
				var box = size(device);
				if (rowX > LAYOUT_MARGIN && rowX + box.width > right) {
					rowX = LAYOUT_MARGIN;
					top += rowHeight + LAYOUT_GAP_Y;
					rowHeight = 0;
				}
				place(device.id, rowX, top);
				rowX += box.width + LAYOUT_GAP_Y;
				rowHeight = Math.max(rowHeight, box.height);
			});
			if (list.length) top += rowHeight + LAYOUT_GAP_Y * 2;
		}
		placeRow(devices.filter(isPowerNode));
		placeRow(devices.filter(function (device) {
			return !isPowerNode(device) && !linked[device.id];
		}));

		undoLayout = previous;
		render();
		$(".signal-flow").scrollTop(0).scrollLeft(0);
	}

	function undoOptimize() {
		if (!undoLayout) return;
		Object.keys(undoLayout).forEach(function (id) {
			if (state.nodes[id]) $.extend(state.nodes[id], undoLayout[id]);
		});
		undoLayout = null;
		render();
	}

	function addEndpoint(type) {
		var id = newId("endpoint");
		state.endpoints.push({ id: id, type: type });
		render();
		return id;
	}

	// Keep an open options menu inside the visible workspace: slide it sideways, open
	// it above its box when there's no room below, or shrink it to the space there is
	var MENU_MARGIN = 8;
	function placeOptions() {
		var $menu = $(".flow-node.is-menu-open .flow-node__options");
		if (!$menu.length) return;
		$menu.css({ left: "", right: "", top: "", bottom: "", maxHeight: "" });

		// The visible part of the workspace: not under the sidebar, not past the window
		var rect = $(".signal-flow")[0].getBoundingClientRect();
		var view = {
			left: Math.max(rect.left, 0),
			top: Math.max(rect.top, 0),
			right: Math.min(rect.right, document.documentElement.clientWidth),
			bottom: Math.min(rect.bottom, document.documentElement.clientHeight),
		};
		var box = $menu.closest(".flow-node")[0].getBoundingClientRect();
		var menu = $menu[0].getBoundingClientRect();
		var minLeft = view.left + MENU_MARGIN;
		var maxRight = view.right - MENU_MARGIN;

		var shift = 0;
		if (menu.left < minLeft) shift = minLeft - menu.left;
		else if (menu.right > maxRight) shift = Math.max(minLeft - menu.left, maxRight - menu.right);
		if (shift) $menu.css({ left: menu.left + shift - box.left, right: "auto" });

		var below = view.bottom - MENU_MARGIN - menu.top;
		var above = box.top - (view.top + MENU_MARGIN);
		if (menu.height > below && above > below) {
			// Open upward from the top of the box
			$menu.css({ top: "auto", bottom: box.height - 1, maxHeight: Math.max(80, above) });
		} else if (menu.height > below) {
			$menu.css({ maxHeight: Math.max(80, below) });
		}
	}

	// Grow the drawing surface so boxes moved right or down stay reachable by scrolling
	function resizeSurface() {
		var $surface = $(".signal-flow__surface");
		var width = 0;
		var height = 0;
		$(".flow-node").each(function () {
			var pos = $(this).position();
			width = Math.max(width, pos.left + $(this).outerWidth());
			height = Math.max(height, pos.top + $(this).outerHeight());
		});
		$surface.css({ width: width + 200, height: height + 200 });
	}

	function portElement(node, port) {
		return $('.flow-node[data-id="' + node + '"] .flow-port[data-port="' + port + '"] .flow-port__dot');
	}

	// Center of a port's dot, in surface coordinates
	function dotCenter($dot) {
		var surface = $(".signal-flow__surface")[0].getBoundingClientRect();
		var rect = $dot[0].getBoundingClientRect();
		return {
			x: rect.left + rect.width / 2 - surface.left,
			y: rect.top + rect.height / 2 - surface.top,
		};
	}

	function pointerPosition(e) {
		var surface = $(".signal-flow__surface")[0].getBoundingClientRect();
		return { x: e.clientX - surface.left, y: e.clientY - surface.top };
	}

	// Cable curve from a to b. Each end leaves its box away from the edge its port is on:
	// left from the "in" side, right from the "out" side, down from the "bottom".
	function wirePath(a, b, aSide, bSide) {
		var dx = Math.max(40, Math.abs(b.x - a.x) / 2);
		var dy = Math.max(40, Math.abs(b.x - a.x) / 4);
		function control(point, side) {
			if (side === "bottom") return point.x + "," + (point.y + dy);
			return point.x + (side === "in" ? -dx : dx) + "," + point.y;
		}
		return "M" + a.x + "," + a.y + " C" + control(a, aSide) + " " + control(b, bSide) + " " + b.x + "," + b.y;
	}

	function svgElement(name, attrs) {
		var el = document.createElementNS(SVG_NS, name);
		Object.keys(attrs).forEach(function (key) {
			el.setAttribute(key, attrs[key]);
		});
		return el;
	}

	function drawWires() {
		var svg = $(".signal-flow__wires")[0];
		$(svg).find(".flow-wire").remove();
		$(".flow-port").removeClass("is-connected");

		state.connections.forEach(function (c, index) {
			// Cables of hidden types aren't drawn
			if (isHidden(c.type)) return;
			var $from = portElement(c.from.node, c.from.port);
			var $to = portElement(c.to.node, c.to.port);
			if (!$from.length || !$to.length) return;

			var $fromPort = $from.closest(".flow-port").addClass("is-connected");
			var $toPort = $to.closest(".flow-port").addClass("is-connected");

			var d = wirePath(dotCenter($from), dotCenter($to), $fromPort.data("side"), $toPort.data("side"));
			var warning = !!power.warnings[index];
			var group = svgElement("g", { class: "flow-wire flow-type--" + c.type + (warning ? " is-warning" : ""), "data-index": index });
			var title = svgElement("title", {});
			title.textContent = (warning ? "Power problem, hover the pedal's Power jack for details. " : "") + "Click to remove connection";
			group.appendChild(title);
			group.appendChild(svgElement("path", { class: "flow-wire__hit", d: d }));
			group.appendChild(svgElement("path", { class: "flow-wire__line", d: d }));
			svg.appendChild(group);
		});
	}

	// ----------------------------------------------------------------------------------
	// Connections

	function samePort(a, b) {
		return a.node === b.node && a.port === b.port;
	}

	// shared: both jacks work both ways (pedal power and MIDI chains), so they can
	// take more than one cable
	function connect(output, input, type, shared) {
		state.connections = state.connections.filter(function (c) {
			var touches = samePort(c.from, output) || samePort(c.to, output) || samePort(c.from, input) || samePort(c.to, input);
			// Never two cables between the same pair of jacks
			if ((samePort(c.from, output) && samePort(c.to, input)) || (samePort(c.from, input) && samePort(c.to, output))) {
				return false;
			}
			// A combined MIDI/CTRL jack holds one kind of cable at a time
			if (touches && c.type !== type) return false;
			// One cable per jack: replace anything already plugged into either port
			return shared || !(samePort(c.from, output) || samePort(c.to, input));
		});
		state.connections.push({ id: newId("cable"), from: output, to: input, type: type });
		// Full redraw, as a cable can change the power status shown on the jacks
		render();
	}

	function portInfo($port) {
		return {
			node: $port.closest(".flow-node").data("id"),
			port: $port.data("port"),
			types: String($port.attr("data-type")).split(" "),
			directions: String($port.attr("data-direction")).split(" "),
			connector: $port.attr("data-connector") || null,
			side: $port.data("side"),
		};
	}

	// The signal type a cable between two ports would carry, or null if they can't be
	// connected: a shown type both jacks carry, on different pedals, and not two inputs
	// or two outputs. Prefers the order of a's types (MIDI first on a shared jack).
	function cableType(a, b) {
		if (a.node === b.node) return null;
		return a.types.filter(function (type) {
			if (b.types.indexOf(type) === -1 || isHidden(type)) return false;
			var da = directionFor(a, type);
			var db = directionFor(b, type);
			return da !== db || da === "both";
		})[0] || null;
	}

	// Connect two dropped-together ports, first asking about Y cables or power problems
	function requestConnection(origin, target) {
		var type = cableType(origin, target);
		// The cable runs from the output; between two two-way jacks, from where the drag started
		var originDirection = directionFor(origin, type);
		var targetDirection = directionFor(target, type);
		var originIsOutput = originDirection === "out" || (originDirection === "both" && targetDirection !== "out");
		var output = originIsOutput ? origin : target;
		var input = originIsOutput ? target : origin;
		var request = {
			output: { node: output.node, port: output.port },
			input: { node: input.node, port: input.port },
			type: type,
			shared: originDirection === "both" && targetDirection === "both",
			outputConnector: output.connector,
			inputConnector: input.connector,
		};
		function plain() {
			connect(request.output, request.input, request.type, request.shared);
		}

		// Stereo TRS jack to mono TS jack
		var connectors = [request.outputConnector, request.inputConnector].sort().join();
		if (connectors === "TRS,TS") {
			var trs = request.outputConnector === "TRS" ? output : input;
			var ts = trs === output ? input : output;
			askChoice({
				title: "Stereo to mono",
				message:
					describe(trs) + " is a stereo TRS jack and " + describe(ts) + " is a mono TS jack. " +
					"A Y cable splits the TRS jack into two TS plugs (tip and ring); the second plug is left loose so you can connect it somewhere else.",
				choices: [
					{ label: "Use a Y cable", primary: true, action: function () { addJunction(request, request.outputConnector === "TRS" ? "split" : "merge"); } },
					{ label: "Use a regular cable", action: plain },
				],
			});
			return;
		}

		if (type === "power") {
			var problem = powerProblem(request);
			if (problem) {
				askChoice({ title: "Power", message: problem.message, choices: problem.choices.concat({ label: "Connect anyway", action: plain }) });
				return;
			}
		}
		plain();
	}

	function describe(info) {
		var device = devicesById(getDevices())[info.node];
		var port = device && findPort(device.ports, info.port);
		return device && port ? device.name + " " + port.label : info.port;
	}

	// What goes wrong for the pedal if this power cable is added, with suggested fixes
	function powerProblem(request) {
		var devices = getDevices();
		var byId = devicesById(devices);
		var trial = analyzePower(devices, state.connections.concat({ from: request.output, to: request.input, type: "power" }));
		var pedalEnd = [request.input, request.output].filter(function (end) {
			var jack = loadJack(byId[end.node]);
			return jack && jack.id === end.port;
		})[0];
		var info = pedalEnd && trial.jacks[portKey(pedalEnd.node, pedalEnd.port)];
		if (!info || !info.problem || !info.source) return null;

		var choices = [];
		var sourceDevice = byId[request.output.node];
		var sourcePort = sourceDevice && findPort(sourceDevice.ports, request.output.port);
		var fromSupply = sourceDevice && sourceDevice.kind === "supply";
		var wrongVoltage = info.source.voltage !== info.needs;
		var canSwitch = sourcePort && sourcePort.switchable && (!sourcePort.voltageOptions || !sourcePort.voltageOptions.length || sourcePort.voltageOptions.indexOf(info.needs) !== -1);
		if (fromSupply && wrongVoltage && canSwitch) {
			choices.push({
				label: "Switch " + sourcePort.label + " to " + info.needs + "V" + (sourcePort.currentByVoltage ? " (" + currentAt(sourcePort, info.needs) + " mA)" : ""),
				primary: true,
				action: function () {
					setOutput(request.output.node, sourcePort.index, { v: info.needs });
					connect(request.output, request.input, "power", false);
					render();
				},
			});
		}
		if (fromSupply && wrongVoltage && info.needs === info.source.voltage * 2) {
			choices.push({ label: "Use a voltage doubler (series cable)", primary: !choices.length, action: function () { addJunction(request, "series"); } });
		}
		if (fromSupply && !wrongVoltage && info.load > info.source.current) {
			choices.push({ label: "Use a current doubler (parallel Y cable)", primary: true, action: function () { addJunction(request, "parallel"); } });
		}
		var message = describe(pedalEnd) + ": " + info.problem + ".";
		if (choices.length) message += " A two-output cable takes power from a second output on the supply; its second plug is left loose for you to connect.";
		return { message: message, choices: choices };
	}

	// Put a Y cable (or a series/parallel power cable) between the two jacks of a request.
	// One leg is plugged in; the other is left loose.
	function addJunction(request, mode) {
		var id = newId("junction");
		state.junctions.push({ id: id, type: request.type, mode: mode });
		state.nodes[id] = junctionSpot(request.output.node, request.input.node);

		var junction = function (port) {
			return { node: id, port: port };
		};
		if (mode === "split") {
			connect(request.output, junction("trs"), request.type, false);
			connect(junction("tip"), request.input, request.type, false);
		} else if (mode === "merge") {
			connect(request.output, junction("tip"), request.type, false);
			connect(junction("trs"), request.input, request.type, false);
		} else {
			connect(request.output, junction("in1"), "power", false);
			connect(junction("out"), request.input, "power", false);
		}
		render();
	}

	// Below the two boxes a junction connects, midway between them, clear of other boxes
	function junctionSpot(nodeA, nodeB) {
		var boxes = $(".flow-node")
			.map(function () {
				var pos = $(this).position();
				return { id: $(this).data("id"), left: pos.left, top: pos.top, right: pos.left + $(this).outerWidth(), bottom: pos.top + $(this).outerHeight() };
			})
			.get();
		var ends = boxes.filter(function (box) {
			return box.id === nodeA || box.id === nodeB;
		});
		var x = Math.max(0, Math.round((ends[0].left + ends[0].right + ends[ends.length - 1].left + ends[ends.length - 1].right) / 4 - JUNCTION_WIDTH / 2));
		var y = Math.max.apply(null, ends.map(function (box) {
			return box.bottom;
		})) + 30;
		var height = 100;
		var blocked = function () {
			return boxes.some(function (box) {
				return x < box.right && x + JUNCTION_WIDTH > box.left && y < box.bottom + 20 && y + height > box.top - 20;
			});
		};
		while (blocked()) y += 40;
		return { x: x, y: Math.round(y) };
	}

	// Remove a Y cable or an endpoint box, with its cables
	function removeNode(id) {
		var other = function (item) {
			return item.id !== id;
		};
		state.junctions = state.junctions.filter(other);
		state.endpoints = state.endpoints.filter(other);
		state.connections = state.connections.filter(function (c) {
			return c.from.node !== id && c.to.node !== id;
		});
		delete state.nodes[id];
		render();
	}

	// A dialog with a message and a button per choice (plus Cancel)
	function askChoice(options) {
		var $modal = $("#flow-choice-modal");
		$modal.find(".modal-title").text(options.title);
		$modal.find(".flow-choice__message").text(options.message);
		var $buttons = $modal.find(".flow-choice__buttons").empty();
		$('<button type="button" class="btn btn-default" data-dismiss="modal">Cancel</button>').appendTo($buttons);
		options.choices.forEach(function (choice) {
			$('<button type="button" class="btn">')
				.addClass(choice.primary ? "btn-primary" : "btn-default")
				.text(choice.label)
				.on("click", function () {
					$modal.modal("hide");
					choice.action();
				})
				.appendTo($buttons);
		});
		$modal.modal("show");
	}

	// Change one of a supply's outputs, keeping the others as they are now
	function setOutput(id, index, changes) {
		var options = state.nodes[id];
		var device = deviceFor($("#" + id));
		var ports = supplyOutputPorts(device);
		var outputs = ports.map(function (port) {
			return { v: port.voltage, ma: port.current, sw: port.switchable };
		});
		var ratings = ports[index].currentByVoltage;
		if (changes.v && ratings && ratings[changes.v]) changes = $.extend({ ma: ratings[changes.v] }, changes);
		$.extend(outputs[index], changes);
		options.outputs = outputs;
	}

	// The voltages a supply output's switch can select
	function switchVoltages(port) {
		return port.voltageOptions && port.voltageOptions.length ? port.voltageOptions : VOLTAGES;
	}

	// mA an output gives at a voltage, when its switch derates it
	function currentAt(port, voltage) {
		return (port.currentByVoltage && port.currentByVoltage[voltage]) || port.current;
	}

	function supplyOutputPorts(device) {
		return allPorts(device.ports).filter(function (port) {
			return port.index !== undefined;
		});
	}

	function startConnect(e) {
		// The voltage switch on a supply output is used in place, not dragged
		if (e.button !== 0 || $(e.target).closest(".flow-port__switch").length) return;
		e.preventDefault();
		e.stopPropagation();

		var origin = portInfo($(this));
		var start = dotCenter($(this).find(".flow-port__dot"));
		var pending = svgElement("path", { class: "flow-wire__pending flow-type--" + origin.types[0], d: "" });
		$(".signal-flow__wires")[0].appendChild(pending);

		// Highlight the ports this drag can end on
		$(".flow-port").each(function () {
			$(this).toggleClass("is-target", !!cableType(origin, portInfo($(this))));
		});
		$(".signal-flow").addClass("is-connecting");

		function targetUnder(ev) {
			var $target = $(document.elementFromPoint(ev.clientX, ev.clientY)).closest(".flow-port.is-target");
			return $target.length ? $target : null;
		}

		$(document).on("pointermove.flowConnect", function (ev) {
			var $target = targetUnder(ev);
			$(".flow-port.is-hover").removeClass("is-hover");
			pending.setAttribute("class", "flow-wire__pending flow-type--" + ($target ? cableType(origin, portInfo($target)) : origin.types[0]));
			var end = $target ? dotCenter($target.addClass("is-hover").find(".flow-port__dot")) : pointerPosition(ev);
			var endSide = $target ? $target.data("side") : { in: "out", out: "in", bottom: "bottom" }[origin.side];
			pending.setAttribute("d", wirePath(start, end, origin.side, endSide));
		});

		$(document).on("pointerup.flowConnect pointercancel.flowConnect", function (ev) {
			// Find the drop target before clearing the highlight classes it relies on
			var $target = ev.type === "pointerup" ? targetUnder(ev) : null;

			$(document).off(".flowConnect");
			pending.remove();
			$(".signal-flow").removeClass("is-connecting");
			$(".flow-port").removeClass("is-target is-hover");

			if ($target) requestConnection(origin, portInfo($target));
		});
	}

	// ----------------------------------------------------------------------------------
	// Moving boxes

	function startMove(e) {
		if (e.button !== 0 || $(e.target).closest(".flow-port, .flow-node__menu-btn, .flow-node__options, .flow-node__remove").length) return;
		e.preventDefault();

		var $node = $(this).css("z-index", ++topZ).addClass("is-dragging");
		var id = $node.data("id");
		var startPointer = { x: e.clientX, y: e.clientY };
		var startPos = { x: parseFloat($node.css("left")) || 0, y: parseFloat($node.css("top")) || 0 };

		$(document).on("pointermove.flowMove", function (ev) {
			var x = Math.max(0, startPos.x + ev.clientX - startPointer.x);
			var y = Math.max(0, startPos.y + ev.clientY - startPointer.y);
			$node.css({ left: x, top: y });
			state.nodes[id] = $.extend(state.nodes[id], { x: x, y: y });
			drawWires();
		});

		$(document).on("pointerup.flowMove pointercancel.flowMove", function () {
			$(document).off(".flowMove");
			$node.removeClass("is-dragging");
			resizeSurface();
			save();
		});
	}

	// ----------------------------------------------------------------------------------
	// Events

	$(document).on("viewshown", function (e, view) {
		if (view === "signal-flow") render();
	});

	$(document).on("playgroundchange", function () {
		if (isVisible()) render();
	});

	$(document).on("pointerdown", ".signal-flow .flow-port", startConnect);
	$(document).on("pointerdown", ".signal-flow .flow-node", startMove);

	$(document).on("click", ".signal-flow .flow-filter", function () {
		var type = $(this).data("type");
		state.hidden = isHidden(type)
			? state.hidden.filter(function (id) {
					return id !== type;
			  })
			: state.hidden.concat(type);
		render();
	});

	$(document).on("click", ".signal-flow .flow-node__menu-btn", function () {
		var id = $(this).closest(".flow-node").data("id");
		openMenu = openMenu === id ? null : id;
		render();
	});

	// Clicking anywhere else closes the options. Listens in the capture phase, as
	// starting a cable or a box drag stops the event from bubbling.
	document.addEventListener(
		"pointerdown",
		function (e) {
			if (openMenu && !$(e.target).closest(".flow-node__menu-btn, .flow-node__options").length) {
				openMenu = null;
				$(".flow-node.is-menu-open").removeClass("is-menu-open").find(".flow-node__menu-btn").attr("aria-expanded", false);
			}
		},
		true
	);

	$(document).on("change", ".signal-flow .flow-option", function () {
		var id = $(this).closest(".flow-node").data("id");
		var options = state.nodes[id];
		var index = $(this).data("index");
		switch ($(this).data("option")) {
			case "sharedMidiCtrl":
				return setSharedMidiCtrl(id, this.checked);
			case "powerSupply":
				options.powerSupply = this.checked;
				break;
			case "voltage":
				options.voltage = Number(this.value);
				break;
			case "current":
				options.current = Math.max(0, Number(this.value) || 0);
				break;
			case "connector":
				options.connectors = $.extend({}, options.connectors);
				options.connectors[$(this).data("jack")] = this.value;
				break;
			case "outputCount":
				var count = Math.min(MAX_OUTPUTS, Math.max(1, parseInt(this.value, 10) || 1));
				var outputs = supplyOutputs(options).slice(0, count);
				while (outputs.length < count) outputs.push($.extend({}, DEFAULT_OUTPUT));
				options.outputs = outputs;
				break;
			case "outputVoltage":
				setOutput(id, index, { v: Number(this.value) });
				break;
			case "outputCurrent":
				setOutput(id, index, { ma: Math.max(0, Number(this.value) || 0) });
				break;
			case "outputSwitch":
				setOutput(id, index, { sw: this.checked });
				break;
			case "channelCount":
				var endpoint = endpointById(id);
				var side = $(this).data("side");
				var count = Math.min(MAX_CHANNELS, Math.max(0, parseInt(this.value, 10) || 0));
				editableChannels(endpoint);
				while (endpoint[side].length < count) endpoint[side].push($.extend({}, ENDPOINTS[endpoint.type].defaults[side][0]));
				endpoint[side].length = count;
				break;
			case "channelConnector":
				endpoint = endpointById(id);
				editableChannels(endpoint);
				endpoint[$(this).data("side")][index].connector = this.value;
				break;
		}
		render();
	});

	// Interface and channel names: saved as you type and updated on the box in place,
	// without redrawing it, so the text box keeps focus
	$(document).on("input", ".signal-flow .flow-text", function () {
		var $node = $(this).closest(".flow-node");
		var endpoint = endpointById($node.data("id"));
		var text = $.trim(this.value);
		if ($(this).data("field") === "name") {
			if (text) endpoint.name = text;
			else delete endpoint.name;
			var name = endpointName(endpoint);
			$node.find(".flow-node__title").text(name).end().find(".flow-node__name").attr("title", name);
			$node.find(".flow-node__remove").attr({ title: "Remove " + name, "aria-label": "Remove " + name });
			$node.css("width", boxWidth({ kind: "endpoint", name: name }));
		} else {
			var side = $(this).data("side");
			var index = $(this).data("index");
			editableChannels(endpoint);
			if (text) endpoint[side][index].label = text;
			else delete endpoint[side][index].label;
			var label = channelLabel(side, index, endpoint[side][index]);
			var $label = $node.find('.flow-port[data-port="' + (side === "inputs" ? "in" : "out") + (index + 1) + '"] .flow-port__label');
			$label.attr("title", label + " (" + endpoint[side][index].connector + ")").contents().first()[0].nodeValue = label;
		}
		drawWires();
		save();
	});

	$(document).on("click", ".signal-flow .flow-tool--optimize", optimizeLayout);
	$(document).on("click", ".signal-flow .flow-tool--undo", undoOptimize);

	$(document).on("click", ".signal-flow .flow-add__item", function (e) {
		e.preventDefault();
		addEndpoint($(this).data("endpoint"));
	});

	$(document).on("click", ".signal-flow .flow-node__remove", function () {
		removeNode($(this).closest(".flow-node").data("id"));
	});

	$(document).on("click", ".signal-flow .flow-wire", function () {
		state.connections.splice($(this).data("index"), 1);
		render();
	});

	$(window).on("resize", function () {
		if (!isVisible()) return;
		drawWires();
		placeOptions();
	});

	$(".signal-flow").on("scroll", placeOptions);

	return {
		types: TYPES,
		junctions: JUNCTIONS,
		endpoints: ENDPOINTS,
		addEndpoint: addEndpoint,
		optimizeLayout: optimizeLayout,
		// Every cable in the current signal flow (including hidden types), each with the
		// segments whose length can be entered. Plain cables have from/to ends; a Y cable
		// is one item with an end per plug (null when loose); a power daisy chain is one
		// item with its source and the pedals it feeds, one segment per stretch of cable.
		getCables: function () {
			var devices = getDevices();
			if (prune(devices)) devices = getDevices();
			var byId = devicesById(devices);
			function end(node, port) {
				var device = byId[node];
				return { id: device.id, name: device.name, port: findPort(device.ports, port) };
			}
			function kindOf(e) {
				return byId[e.node].kind;
			}
			function segment(id, label, title) {
				return { id: id, label: label, title: title, length: state.lengths[id] || "" };
			}
			var cables = [];

			// Power daisy chains: pedal power jacks cabled to each other, plus the cable
			// from the supply output that feeds them
			var inChain = {};
			var parent = {};
			function find(key) {
				while (parent[key] && parent[key] !== key) key = parent[key];
				return key;
			}
			var links = state.connections.filter(function (c) {
				return c.type === "power" && kindOf(c.from) === "pedal" && kindOf(c.to) === "pedal";
			});
			links.forEach(function (c) {
				var a = portKey(c.from.node, c.from.port);
				var b = portKey(c.to.node, c.to.port);
				parent[a] = parent[a] || a;
				parent[b] = parent[b] || b;
				parent[find(a)] = find(b);
			});
			var chains = {};
			links.forEach(function (c) {
				var root = find(portKey(c.from.node, c.from.port));
				(chains[root] = chains[root] || { links: [], feeds: [] }).links.push(c);
			});
			state.connections.forEach(function (c) {
				if (c.type !== "power") return;
				var pedalEnd = kindOf(c.to) === "pedal" ? c.to : kindOf(c.from) === "pedal" ? c.from : null;
				var other = pedalEnd === c.to ? c.from : c.to;
				if (!pedalEnd || kindOf(other) !== "supply") return;
				var root = parent[portKey(pedalEnd.node, pedalEnd.port)] && find(portKey(pedalEnd.node, pedalEnd.port));
				if (root && chains[root]) chains[root].feeds.push(c);
			});
			Object.keys(chains).forEach(function (root) {
				var chain = chains[root];
				// Walk the chain from where it's fed, so segments run A, B, C... down the cable
				var ordered = [];
				var drops = [];
				var seen = {};
				var queue = [];
				function visit(e) {
					var key = portKey(e.node, e.port);
					if (seen[key]) return;
					seen[key] = true;
					drops.push(end(e.node, e.port));
					queue.push(key);
				}
				chain.feeds.forEach(function (c) {
					ordered.push(c);
					visit(kindOf(c.to) === "pedal" ? c.to : c.from);
				});
				if (!queue.length) visit(chain.links[0].from);
				while (queue.length) {
					var key = queue.shift();
					chain.links.forEach(function (c) {
						var a = portKey(c.from.node, c.from.port);
						var b = portKey(c.to.node, c.to.port);
						if ((a === key || b === key) && ordered.indexOf(c) === -1) {
							ordered.push(c);
							visit(a === key ? c.to : c.from);
						}
					});
				}
				ordered.forEach(function (c) {
					inChain[c.id] = true;
				});
				var source = chain.feeds[0] && (kindOf(chain.feeds[0].from) === "supply" ? chain.feeds[0].from : chain.feeds[0].to);
				cables.push({
					type: typeInfo("power"),
					chain: true,
					source: source ? end(source.node, source.port) : null,
					drops: drops,
					segments: ordered.map(function (c, i) {
						var from = end(c.from.node, c.from.port);
						var to = end(c.to.node, c.to.port);
						return segment(c.id, String.fromCharCode(65 + i), from.name + " " + from.port.label + " → " + to.name + " " + to.port.label);
					}),
				});
			});

			state.connections.forEach(function (c) {
				if (inChain[c.id] || kindOf(c.from) === "junction" || kindOf(c.to) === "junction") return;
				cables.push({ type: typeInfo(c.type), from: end(c.from.node, c.from.port), to: end(c.to.node, c.to.port), segments: [segment(c.id, "")] });
			});
			state.junctions.forEach(function (junction) {
				var device = byId[junction.id];
				cables.push({
					type: typeInfo(junction.type),
					junction: JUNCTIONS[junction.mode],
					segments: [segment(junction.id, "")],
					plugs: allPorts(device.ports).map(function (port) {
						var c = state.connections.filter(function (c) {
							return samePort(c.from, { node: junction.id, port: port.id }) || samePort(c.to, { node: junction.id, port: port.id });
						})[0];
						var other = c && (c.from.node === junction.id ? c.to : c.from);
						// Side A is the single plug, side B the two legs
						var single = device.ports.inputs.length === 1 ? device.ports.inputs : device.ports.outputs;
						return {
							label: port.label,
							connector: port.connector,
							side: single.indexOf(port) !== -1 ? "A" : "B",
							end: other ? end(other.node, other.port) : null,
						};
					}),
				});
			});
			return cables;
		},
		// Category and power details of a pedal on the playground
		deviceInfo: function (id) {
			var device = deviceFor($("#" + id));
			var info = { kind: device.kind, subcategory: device.spec ? device.spec.subcategory : device.kind === "supply" ? "Power Supply" : "" };
			if (device.kind === "supply") {
				info.outputs = supplyOutputPorts(device).map(function (port) {
					return { v: port.voltage, ma: port.current, sw: port.switchable };
				});
			}
			return info;
		},
		// Replace the device specifications (the "devices" list of my-devices.json)
		setSpecs: function (devices) {
			specs = devices || [];
			$(document).trigger("playgroundchange");
		},
		getPower: function () {
			var devices = getDevices();
			if (prune(devices)) devices = getDevices();
			return analyzePower(devices, state.connections);
		},
		// Length of a cable (or Y cable, or daisy-chain segment), as typed in the Parts List
		setLength: function (id, length) {
			if (length) state.lengths[id] = length;
			else delete state.lengths[id];
			save();
		},
		getState: function () {
			return state;
		},
		setState: function (saved) {
			state = normalize(saved);
			if (isVisible()) {
				render();
			} else {
				prune(getDevices());
				save();
			}
		},
	};
})(jQuery);
