/**
 * Class to read instance and solution files of pdptw-instances.
 * Stores the instance and solution in appropriate fields.
 */
class Reader {
    #reader;
    instance;
    solution;
    custom_end_function;
    #bound_instance_parser;
    #bound_solution_parser;

    constructor() {
        this.#reader = new FileReader();
        this.instance = {};
        this.solution = {};

        this.custom_end_function = {};
        this.#bound_instance_parser = this.#instance_parser.bind(this);
        this.#bound_solution_parser = this.#solution_parser.bind(this);
    }

    read_instance(file, custom_end_function) {
        this.custom_end_function = custom_end_function;
        this.#reader.onloadend = this.#bound_instance_parser;
        this.#reader.readAsText(file);
    }

    read_solution(file, custom_end_function) {
        console.log("Starting to read solution file");
        this.custom_end_function = custom_end_function;
        this.#reader.onloadend = this.#bound_solution_parser;
        this.#reader.readAsText(file);
    }

    #instance_parser() {
        this.instance = new Instance();

        const elements = this.#reader.result.split('\n');
        for (let l = 0; l < elements.length; l++) {
            let line = elements[l];
            const tv = this.#token_and_value(line);
            const token = tv[0].trim(); // Trimmed token

            if (token === "NAME") {
                this.instance.name = tv[1].replace(/\s+/g, "");
            } else if (token === "LOCATION") {
                this.instance.location = tv[1];
            } else if (token === "TYPE") {
                this.instance.type = tv[1];
            } else if (token === "SIZE") {
                this.instance.size = parseInt(tv[1]);
            } else if (token === "CAPACITY") {
                this.instance.capacity = parseInt(tv[1]);
            } else if (
                token === "COMMENT" ||
                token === "DISTRIBUTION" ||
                token === "DEPOT" ||
                token === "ROUTE-TIME" ||
                token === "TIME-WINDOW"
            ) {
                // ignore...
            } else if (token === "NODES") {
                l = this.#node_reader(elements, l + 1);
            } else if (token === "EDGES") {
                l = this.#edge_reader(elements, l + 1);
            } else if (token === "EOF") {
                break;
            } else {
                alert("ERROR: Unknown keyword '" + token + "' token in instance file.\nAre you sure you are trying to load a valid instance file?");
                return;
            }
        }

        this.custom_end_function();
    }

    #node_reader(elements, index) {
        this.instance.nodes = [];
        this.instance.all_coords = [];

        for (let i = 0; i < this.instance.size; i++) {
            let line = elements[index + i];
            let values = line.split(" ");
            let node = new Node(
                parseInt(values[0]),
                [parseFloat(values[1]), parseFloat(values[2])],
                parseInt(values[3]),
                [parseInt(values[4]), parseInt(values[5])],
                parseInt(values[6]),
                parseInt(values[7]),
                parseInt(values[8])
            );

            this.instance.all_coords.push(node.coords);
            this.instance.nodes.push(node);
        }
        return index + this.instance.size - 1;
    }

    #edge_reader(elements, index) {
        this.instance.times = [];
        for (let i = 0; i < this.instance.size; i++) {
            let line = elements[index + i];
            let values = line.split(" ");
            let times_i = [];
            for (const vstr of values) {
                times_i.push(parseInt(vstr, 10));
            }
            this.instance.times.push(times_i);
        }

        return index + this.instance.size - 1;
    }

    #set_route_colors() {
        console.log("Setting route colors");
        const vec_colors = ["#3775b2", "#b1b945", "#45b940", "#953fbb", "#64d65f", "#396ced", "#7e54d4", "#529d21", "#da68e2", "#8dc74e"];
        let c = 0;
        while (c < this.solution.routes.length) {
            this.solution.routes[c].set_color(vec_colors[c % vec_colors.length]);
            c += 1;
        }
    }

    #solution_parser() {
        console.log("Solution parser called");
        let elements = this.#reader.result.split('\n');
        console.log("Number of lines in solution file:", elements.length);
        let routes = [];
        let name = "";
        let reference = "";
        let date = "";
        let author = "";

        for (var l = 0; l < elements.length; l++) {
            let line = elements[l];
            console.log("Processing line:", line);

            const tv = this.#token_and_value(line);
            console.log("Token and value:", tv);

            let token = tv[0].trim(); // Trimmed token

            if (token === "Instance name") {
                name = tv[1].replace(/\s+/g, "");
                console.log("Found instance name:", name);

                // Removed header validation check - allow any instance name
                // if (name !== this.instance.name) {
                //     console.error("Instance name mismatch:", name, "vs", this.instance.name);
                //     alert("ERROR: Solution name does not correspond to instance name.\nSolution is '".concat(name).concat("' while the loaded instance has name '").concat(this.instance.name) + "'");
                //     return;
                // }
            } else if (token === "Authors") {
                author = tv[1];
                console.log("Found author:", author);
            } else if (token === "Date") {
                date = tv[1];
                console.log("Found date:", date);
            } else if (token === "Reference") {
                reference = tv[1];
                console.log("Found reference:", reference);
            } else if (token === "Solution") {
                console.log("Found Solution section, starting route parser");
                routes = this.#route_reader(elements, l + 1);
                console.log("Routes parsed:", routes.length);
                l = elements.length;
            } else {
                console.error("Unknown token:", token);
                alert("ERROR: Unknown keyword '" + token + "' token in solution file.\nAre you sure the solution file is properly formatted?");
                return;
            }
        }

        if (routes.length === 0) {
            console.error("No routes were parsed!");
            return;
        }

        console.log("Creating Solution object");
        this.solution = new Solution(name, reference, date, author, routes);
        console.log("Setting route colors");
        this.#set_route_colors();
        console.log("Calling custom end function");
        this.custom_end_function();
    }

    #route_reader(elements, index) {
        console.log("Route reader called, starting at line", index);
        let routes = [];
        let r = 0;
        for (let i = index; i < elements.length; i++) {
            let line = elements[i].trim();
            console.log("Processing route line:", line);

            if (line.length === 0) {
                console.log("Empty line, breaking");
                break;
            }

            // Modified the route parsing to handle "Route X : sequence" format
            if (!line.startsWith("Route")) {
                console.log("Line doesn't start with 'Route', skipping");
                continue;
            }

            let parts = line.split(":");
            console.log("Split line into parts:", parts);

            if (parts.length !== 2) {
                console.log("Line doesn't have exactly one colon, skipping");
                continue;
            }

            let routeNumPart = parts[0].trim(); // "Route X"
            let sequencePart = parts[1].trim(); // The node sequence
            console.log("Route number part:", routeNumPart);
            console.log("Sequence part:", sequencePart);

            // Extract route number
            let routeNumMatch = routeNumPart.match(/Route\s+(\d+)/);
            if (!routeNumMatch) {
                console.log("Couldn't extract route number, skipping");
                continue;
            }

            let routeNum = parseInt(routeNumMatch[1]);
            console.log("Extracted route number:", routeNum);

            // Parse the sequence
            let sequence = sequencePart.split(/\s+/).filter(s => s.length > 0);
            console.log("Sequence nodes:", sequence);

            let route = new Route(r);
            let c = 0;

            // Check if instance and nodes are properly initialized
            if (!this.instance || !this.instance.nodes || !this.instance.nodes[0]) {
                console.error("Instance or nodes not properly initialized");
                console.log("Instance:", this.instance);
                if (this.instance && this.instance.nodes) {
                    console.log("Nodes length:", this.instance.nodes.length);
                }
                continue;
            }

            route.push(0, this.instance.nodes[0].coords);
            let bn = 0;

            try {
                for (const sn of sequence) {
                    if (sn.length === 0) continue;
                    let n = parseInt(sn);
                    console.log(`Processing node ${n}, previous node ${bn}`);

                    // Validate node exists in instance
                    if (n < 0 || n >= this.instance.nodes.length) {
                        console.error(`Node ${n} out of range (0-${this.instance.nodes.length - 1})`);
                        continue;
                    }

                    // Validate times array
                    if (!this.instance.times || !this.instance.times[bn]) {
                        console.error(`Times array not properly initialized for node ${bn}`);
                        console.log("Times array:", this.instance.times);
                        continue;
                    }

                    c += this.instance.times[bn][n];
                    bn = n;
                    route.push(n, this.instance.nodes[n].coords);
                }

                c += this.instance.times[bn][0];
                route.push(0, this.instance.nodes[0].coords);
                route.cost = c;

                routes.push(route);
                r += 1;
                console.log(`Added route ${r} with cost ${c}`);
            } catch (e) {
                console.error("Error while processing route:", e);
            }
        }

        console.log("Returning", routes.length, "routes");
        return routes;
    }

    #token_and_value(str) {
        str = str.replace(/\t/g, "").trim(); // Trimmed line
        let els = str.split(":", 2);
        if (els.length === 1) return [els[0].trim()];
        return [els[0].trim(), els[1].trim()];
    }
}