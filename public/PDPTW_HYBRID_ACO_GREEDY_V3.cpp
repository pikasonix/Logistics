#include <bits/stdc++.h>
using namespace std;

struct Node {
    int id;
    double lat;
    double lon;
    int demand;
    int early_time;
    int late_time;
    int service_duration;
    int pickup_pair;
    int delivery_pair;

    bool is_depot() const { return id == 0; }
    bool is_pickup() const { return demand > 0; }
    bool is_delivery() const { return demand < 0; }
};

struct Instance {
    string name;
    string location;
    int size;
    int capacity;
    int route_time;
    vector<Node> nodes;
    vector<vector<int>> travel_times;
};

// Hybrid Parameters - configurable by user
struct HybridParams {
    int num_ants = 10;
    int max_iterations = 100;
    double alpha = 2.0;
    double beta = 5.0;
    double rho = 0.1;
    double tau_max = 50.0;
    double tau_min = 0.01;
    double greedy_bias = 0.85;
    int elite_solutions = 4;
    double local_search_prob = 0.7;
    int restart_threshold = 9;
};

// Global variables
Instance instance;
Node depot;
vector<Node> pickup_nodes;
vector<Node> delivery_nodes;
vector<vector<double>> pheromone;
HybridParams hybrid_params;

// Global random generators
random_device rd_global;
mt19937 gen_global(rd_global());
uniform_real_distribution<> dis_global(0.0, 1.0);

string trim(const string &str) {
    size_t first = str.find_first_not_of(' ');
    if (string::npos == first)
        return str;
    size_t last = str.find_last_not_of(' ');
    return str.substr(first, (last - first + 1));
}

vector<string> split(const string &str, char delimiter) {
    vector<string> tokens;
    stringstream ss(str);
    string token;
    while (getline(ss, token, delimiter)) {
        string trimmed = trim(token);
        if (!trimmed.empty()) {
            tokens.push_back(trimmed);
        }
    }
    return tokens;
}

int safe_stoi(const string &str, int default_value = 0) {
    try {
        if (str.empty())
            return default_value;
        return stoi(str);
    } catch (const std::exception &e) {
        return default_value;
    }
}

double safe_stod(const string &str, double default_value = 0.0) {
    try {
        if (str.empty())
            return default_value;
        return stod(str);
    } catch (const std::exception &e) {
        return default_value;
    }
}

int parse_parameters_from_input(const string &filename) {
    ifstream file(filename);
    if (!file.is_open()) {
        cout << "Error: Cannot open file " << filename << endl;
        return 3; // default num_routes
    }

    string first_line;
    getline(file, first_line);
    file.close();

    int num_routes = 3; // default

    // Check if first line contains parameters (starts with numbers)
    if (!first_line.empty() && (isdigit(first_line[0]) || first_line[0] == '.')) {
        vector<string> params = split(first_line, ' ');

        if (params.size() >= 12) {
            num_routes = safe_stoi(params[0], 3);
            hybrid_params.num_ants = safe_stoi(params[1], 10);
            hybrid_params.max_iterations = safe_stoi(params[2], 100);
            hybrid_params.alpha = safe_stod(params[3], 2.0);
            hybrid_params.beta = safe_stod(params[4], 5.0);
            hybrid_params.rho = safe_stod(params[5], 0.1);
            hybrid_params.tau_max = safe_stod(params[6], 50.0);
            hybrid_params.tau_min = safe_stod(params[7], 0.01);
            hybrid_params.greedy_bias = safe_stod(params[8], 0.85);
            hybrid_params.elite_solutions = safe_stoi(params[9], 4);
            hybrid_params.local_search_prob = safe_stod(params[10], 0.7);
            hybrid_params.restart_threshold = safe_stoi(params[11], 9);

            cout << "Parameters loaded from file:" << endl;
            cout << "  Routes: " << num_routes << endl;
            cout << "  Ants: " << hybrid_params.num_ants << endl;
            cout << "  Iterations: " << hybrid_params.max_iterations << endl;
            cout << "  Alpha: " << hybrid_params.alpha << endl;
            cout << "  Beta: " << hybrid_params.beta << endl;
            cout << "  Rho: " << hybrid_params.rho << endl;
            cout << "  Tau Max: " << hybrid_params.tau_max << endl;
            cout << "  Tau Min: " << hybrid_params.tau_min << endl;
            cout << "  Greedy Bias: " << hybrid_params.greedy_bias << endl;
            cout << "  Elite Solutions: " << hybrid_params.elite_solutions << endl;
            cout << "  Local Search Prob: " << hybrid_params.local_search_prob << endl;
            cout << "  Restart Threshold: " << hybrid_params.restart_threshold << endl;
        } else {
            cout << "Warning: Not enough parameters in first line, using defaults" << endl;
        }
    } else {
        cout << "No parameters found in first line, using defaults" << endl;
    }

    return num_routes;
}

Instance parse_input(const string &filename) {
    ifstream file(filename);
    if (!file.is_open()) {
        cout << "Error: Cannot open file " << filename << endl;
        exit(1);
    }

    vector<string> lines;
    string line;
    bool first_line = true;

    while (getline(file, line)) {
        string trimmed = trim(line);
        if (!trimmed.empty()) {
            // Skip first line if it contains parameters (starts with numbers)
            if (first_line && (isdigit(trimmed[0]) || trimmed[0] == '.')) {
                first_line = false;
                continue;
            }
            lines.push_back(trimmed);
            first_line = false;
        }
    }
    file.close();

    map<string, string> info;
    int i = 0;
    while (i < lines.size() && lines[i] != "NODES") {
        if (lines[i].find(':') != string::npos) {
            size_t pos = lines[i].find(':');
            string key = trim(lines[i].substr(0, pos));
            string value = trim(lines[i].substr(pos + 1));
            info[key] = value;
        }
        i++;
    }

    i++; // Skip "NODES" line
    vector<Node> nodes;
    int size = safe_stoi(info["SIZE"], 0);

    for (int j = 0; j < size; j++) {
        vector<string> parts = split(lines[i + j], ' ');
        Node node;
        node.id = safe_stoi(parts[0], j);
        node.lat = safe_stod(parts[1], 0.0);
        node.lon = safe_stod(parts[2], 0.0);
        node.demand = safe_stoi(parts[3], 0);
        node.early_time = safe_stoi(parts[4], 0);
        node.late_time = safe_stoi(parts[5], 1440);
        node.service_duration = safe_stoi(parts[6], 0);
        node.pickup_pair = safe_stoi(parts[7], -1);
        node.delivery_pair = safe_stoi(parts[8], -1);
        nodes.push_back(node);
    }

    i += size;
    while (i < lines.size() && lines[i] != "EDGES") {
        i++;
    }
    i++; // Skip "EDGES" line

    vector<vector<int>> travel_times(size, vector<int>(size, 0));
    for (int j = 0; j < size; j++) {
        vector<string> row = split(lines[i + j], ' ');
        for (int k = 0; k < size; k++) {
            travel_times[j][k] = safe_stoi(row[k], 9999);
        }
    }

    Instance inst;
    inst.name = info.count("NAME") ? info["NAME"] : "Unknown";
    inst.location = info.count("LOCATION") ? info["LOCATION"] : "Unknown";
    inst.size = size;
    inst.capacity = info.count("CAPACITY") ? safe_stoi(info["CAPACITY"], 100) : 100;
    inst.route_time = info.count("ROUTE-TIME") ? safe_stoi(info["ROUTE-TIME"], 1440) : 1440;
    inst.nodes = nodes;
    inst.travel_times = travel_times;
    return inst;
}

bool is_feasible_route(const vector<int> &route) {
    if (route.empty())
        return true;

    int current_time = 0;
    int current_load = 0;
    vector<bool> visited_pickup(instance.size, false);

    for (int i = 0; i < route.size(); i++) {
        int node_id = route[i];
        const Node &node = instance.nodes[node_id];

        if (i == 0) {
            current_time += instance.travel_times[0][node_id];
        } else {
            current_time += instance.travel_times[route[i - 1]][node_id];
        }

        if (current_time > node.late_time)
            return false;

        current_time = max(current_time, node.early_time);
        current_time += node.service_duration;

        if (node.is_delivery() && !visited_pickup[node.pickup_pair]) {
            return false;
        }

        if (node.is_pickup()) {
            visited_pickup[node_id] = true;
        }

        current_load += node.demand;
        if (current_load > instance.capacity || current_load < 0) {
            return false;
        }
    }

    int return_time = current_time + instance.travel_times[route.back()][0];
    if (return_time > instance.nodes[0].late_time)
        return false;

    return true;
}

int calculate_route_cost(const vector<int> &route) {
    if (route.empty())
        return 0;

    int total_time = instance.travel_times[0][route[0]];
    for (int i = 0; i < route.size() - 1; i++) {
        total_time += instance.travel_times[route[i]][route[i + 1]];
    }
    total_time += instance.travel_times[route.back()][0];

    return total_time;
}

// Exact same feasibility check as pure greedy
bool is_feasible_insertion(const vector<int> &route, int pickup_id, int delivery_id, int pickup_pos, int delivery_pos) {
    if (pickup_pos > delivery_pos) {
        return false;
    }

    vector<int> new_route = route;
    new_route.insert(new_route.begin() + delivery_pos, delivery_id);
    new_route.insert(new_route.begin() + pickup_pos, pickup_id);

    return is_feasible_route(new_route);
}

// Pure greedy insertion - exactly like PDPTW_GREEDY_INSERTION.cpp
vector<vector<int>> pure_greedy_insertion(int num_routes) {
    vector<vector<int>> routes(num_routes);
    set<int> unvisited_pairs;

    for (const Node &node : pickup_nodes) {
        unvisited_pairs.insert(node.id);
    }

    while (!unvisited_pairs.empty()) {
        struct GreedyInsertion {
            int pickup_id;
            int delivery_id;
            int route_idx;
            int pickup_pos;
            int delivery_pos;
            double efficiency_score;
        };

        GreedyInsertion best_insertion;
        best_insertion.efficiency_score = DBL_MAX;
        bool found_insertion = false;

        for (int pickup_id : unvisited_pairs) {
            int delivery_id = instance.nodes[pickup_id].delivery_pair;

            for (int r = 0; r < num_routes; r++) {
                for (int p_pos = 0; p_pos <= routes[r].size(); p_pos++) {
                    for (int d_pos = p_pos; d_pos <= routes[r].size(); d_pos++) {
                        if (is_feasible_insertion(routes[r], pickup_id, delivery_id, p_pos, d_pos)) {
                            int old_cost = calculate_route_cost(routes[r]);

                            vector<int> new_route = routes[r];
                            new_route.insert(new_route.begin() + d_pos, delivery_id);
                            new_route.insert(new_route.begin() + p_pos, pickup_id);

                            int new_cost = calculate_route_cost(new_route);
                            int cost_increase = new_cost - old_cost;

                            // Pure greedy logic - minimal cost increase
                            double efficiency_score = cost_increase;

                            if (!found_insertion || efficiency_score < best_insertion.efficiency_score) {
                                best_insertion.pickup_id = pickup_id;
                                best_insertion.delivery_id = delivery_id;
                                best_insertion.route_idx = r;
                                best_insertion.pickup_pos = p_pos;
                                best_insertion.delivery_pos = d_pos;
                                best_insertion.efficiency_score = efficiency_score;
                                found_insertion = true;
                            }
                        }
                    }
                }
            }
        }

        if (!found_insertion) {
            break;
        }

        routes[best_insertion.route_idx].insert(
            routes[best_insertion.route_idx].begin() + best_insertion.delivery_pos,
            best_insertion.delivery_id);
        routes[best_insertion.route_idx].insert(
            routes[best_insertion.route_idx].begin() + best_insertion.pickup_pos,
            best_insertion.pickup_id);

        unvisited_pairs.erase(best_insertion.pickup_id);
    }

    return routes;
}

void initialize_pheromone() {
    int n = instance.size;
    pheromone.assign(n, vector<double>(n, 1.0));

    // Initialize with greedy solution paths
    vector<vector<int>> greedy_routes = pure_greedy_insertion(3);

    for (const auto &route : greedy_routes) {
        if (!route.empty()) {
            pheromone[0][route[0]] += 2.0;
            for (int i = 0; i < route.size() - 1; i++) {
                pheromone[route[i]][route[i + 1]] += 2.0;
            }
            pheromone[route.back()][0] += 2.0;
        }
    }
}

struct HybridSolution {
    vector<vector<int>> routes;
    int total_cost;
    int used_routes;

    HybridSolution(int num_routes) : routes(num_routes), total_cost(0), used_routes(0) {}

    void calculate_cost() {
        total_cost = 0;
        used_routes = 0;
        for (const auto &route : routes) {
            if (!route.empty()) {
                total_cost += calculate_route_cost(route);
                used_routes++;
            }
        }
    }

    bool operator<(const HybridSolution &other) const {
        if (used_routes != other.used_routes) {
            return used_routes < other.used_routes;
        }
        return total_cost < other.total_cost;
    }
};

// Simple 2-opt local search
HybridSolution local_search_2opt(const HybridSolution &solution) {
    HybridSolution improved = solution;

    for (int r = 0; r < improved.routes.size(); r++) {
        vector<int> &route = improved.routes[r];
        if (route.size() < 4)
            continue;

        bool improved_route = true;
        while (improved_route) {
            improved_route = false;
            int current_cost = calculate_route_cost(route);

            for (int i = 0; i < route.size() - 3; i++) {
                for (int j = i + 2; j < route.size() - 1; j++) {
                    vector<int> new_route = route;
                    reverse(new_route.begin() + i + 1, new_route.begin() + j + 1);

                    if (is_feasible_route(new_route)) {
                        int new_cost = calculate_route_cost(new_route);
                        if (new_cost < current_cost) {
                            route = new_route;
                            current_cost = new_cost;
                            improved_route = true;
                            break;
                        }
                    }
                }
                if (improved_route)
                    break;
            }
        }
    }

    improved.calculate_cost();
    return improved;
}

class HybridAnt {
private:
    random_device rd;
    mt19937 gen;
    uniform_real_distribution<> dis;

public:
    HybridAnt() : gen(rd()), dis(0.0, 1.0) {}

    HybridSolution construct_solution(int num_routes) {
        HybridSolution solution(num_routes);
        set<int> unvisited_pairs;

        for (const Node &node : pickup_nodes) {
            unvisited_pairs.insert(node.id);
        }

        while (!unvisited_pairs.empty()) {
            int selected_pickup;

            // Very high probability of greedy selection
            if (dis(gen) < hybrid_params.greedy_bias) {
                selected_pickup = select_greedy_pickup(unvisited_pairs, solution);
            } else {
                selected_pickup = select_aco_pickup(unvisited_pairs);
            }

            if (selected_pickup == -1)
                break;

            int delivery_id = instance.nodes[selected_pickup].delivery_pair;
            auto best_insertion = find_best_insertion(solution, selected_pickup, delivery_id);

            if (best_insertion.first != -1) {
                int route_idx = best_insertion.first;
                auto positions = best_insertion.second;

                solution.routes[route_idx].insert(
                    solution.routes[route_idx].begin() + positions.second, delivery_id);
                solution.routes[route_idx].insert(
                    solution.routes[route_idx].begin() + positions.first, selected_pickup);

                unvisited_pairs.erase(selected_pickup);
            } else {
                break;
            }
        }

        solution.calculate_cost();
        return solution;
    }

private:
    int select_greedy_pickup(const set<int> &candidates, const HybridSolution &current_solution) {
        if (candidates.empty())
            return -1;

        int best_pickup = -1;
        int best_cost_increase = INT_MAX;

        for (int pickup_id : candidates) {
            int delivery_id = instance.nodes[pickup_id].delivery_pair;
            int min_cost_increase = INT_MAX;

            for (int r = 0; r < current_solution.routes.size(); r++) {
                const vector<int> &route = current_solution.routes[r];

                for (int p_pos = 0; p_pos <= route.size(); p_pos++) {
                    for (int d_pos = p_pos; d_pos <= route.size(); d_pos++) {
                        if (is_feasible_insertion(route, pickup_id, delivery_id, p_pos, d_pos)) {
                            int old_cost = calculate_route_cost(route);

                            vector<int> test_route = route;
                            test_route.insert(test_route.begin() + d_pos, delivery_id);
                            test_route.insert(test_route.begin() + p_pos, pickup_id);

                            int new_cost = calculate_route_cost(test_route);
                            int cost_increase = new_cost - old_cost;

                            min_cost_increase = min(min_cost_increase, cost_increase);
                        }
                    }
                }
            }

            if (min_cost_increase < best_cost_increase) {
                best_cost_increase = min_cost_increase;
                best_pickup = pickup_id;
            }
        }

        return best_pickup;
    }

    int select_aco_pickup(const set<int> &candidates) {
        if (candidates.empty())
            return -1;

        vector<int> candidate_list(candidates.begin(), candidates.end());
        vector<double> probabilities;
        double total_prob = 0.0;

        for (int pickup_id : candidate_list) {
            double pheromone_val = 0.0;
            double heuristic_val = 0.0;

            // Simple pheromone and heuristic calculation
            for (int j = 0; j < instance.size; j++) {
                if (instance.travel_times[pickup_id][j] > 0) {
                    pheromone_val += pheromone[pickup_id][j];
                    heuristic_val += 1.0 / (instance.travel_times[pickup_id][j] + 1.0);
                }
            }

            double prob = pow(pheromone_val + 0.1, hybrid_params.alpha) *
                          pow(heuristic_val + 0.1, hybrid_params.beta);
            probabilities.push_back(prob);
            total_prob += prob;
        }

        if (total_prob == 0.0)
            return candidate_list[0];

        double r = dis(gen) * total_prob;
        double cumulative = 0.0;
        for (int i = 0; i < candidate_list.size(); i++) {
            cumulative += probabilities[i];
            if (r <= cumulative) {
                return candidate_list[i];
            }
        }

        return candidate_list.back();
    }

    pair<int, pair<int, int>> find_best_insertion(const HybridSolution &solution, int pickup_id, int delivery_id) {
        int best_route = -1;
        pair<int, int> best_positions = {-1, -1};
        int best_cost_increase = INT_MAX;

        for (int r = 0; r < solution.routes.size(); r++) {
            const vector<int> &route = solution.routes[r];

            for (int p_pos = 0; p_pos <= route.size(); p_pos++) {
                for (int d_pos = p_pos; d_pos <= route.size(); d_pos++) {
                    if (is_feasible_insertion(route, pickup_id, delivery_id, p_pos, d_pos)) {
                        int old_cost = calculate_route_cost(route);

                        vector<int> test_route = route;
                        test_route.insert(test_route.begin() + d_pos, delivery_id);
                        test_route.insert(test_route.begin() + p_pos, pickup_id);

                        int new_cost = calculate_route_cost(test_route);
                        int cost_increase = new_cost - old_cost;

                        if (cost_increase < best_cost_increase) {
                            best_cost_increase = cost_increase;
                            best_route = r;
                            best_positions = {p_pos, d_pos};
                        }
                    }
                }
            }
        }

        return {best_route, best_positions};
    }
};

void update_pheromone(const vector<HybridSolution> &solutions) {
    // Evaporation
    for (int i = 0; i < instance.size; i++) {
        for (int j = 0; j < instance.size; j++) {
            pheromone[i][j] = (1.0 - hybrid_params.rho) * pheromone[i][j];
        }
    }

    // Reinforce best solutions
    for (int sol_idx = 0; sol_idx < min(hybrid_params.elite_solutions, (int)solutions.size()); sol_idx++) {
        const HybridSolution &solution = solutions[sol_idx];
        double delta_tau = 10.0 / (solution.total_cost + 1.0);

        for (const auto &route : solution.routes) {
            if (!route.empty()) {
                pheromone[0][route[0]] += delta_tau;
                for (int i = 0; i < route.size() - 1; i++) {
                    pheromone[route[i]][route[i + 1]] += delta_tau;
                }
                pheromone[route.back()][0] += delta_tau;
            }
        }
    }
}

HybridSolution hybrid_aco_solve(int num_routes) {
    initialize_pheromone();

    HybridSolution best_solution(num_routes);
    best_solution.total_cost = INT_MAX;

    // Start with pure greedy solution
    vector<vector<int>> initial_routes = pure_greedy_insertion(num_routes);
    HybridSolution initial_solution(num_routes);
    initial_solution.routes = initial_routes;
    initial_solution.calculate_cost();
    best_solution = initial_solution;

    cout << "Starting Simplified Hybrid ACO-Greedy..." << endl;
    cout << "Initial greedy solution cost: " << best_solution.total_cost << endl;

    int no_improvement_count = 0;

    for (int iter = 0; iter < hybrid_params.max_iterations; iter++) {
        vector<HybridSolution> iteration_solutions;

        // Generate solutions with hybrid ants
        for (int ant = 0; ant < hybrid_params.num_ants; ant++) {
            HybridAnt hybrid_ant;
            HybridSolution solution = hybrid_ant.construct_solution(num_routes);

            // Apply local search occasionally
            if (dis_global(gen_global) < hybrid_params.local_search_prob) {
                solution = local_search_2opt(solution);
            }

            iteration_solutions.push_back(solution);
        }

        // Sort by quality
        sort(iteration_solutions.begin(), iteration_solutions.end());

        // Update best solution
        if (!iteration_solutions.empty() && iteration_solutions[0] < best_solution) {
            best_solution = iteration_solutions[0];
            no_improvement_count = 0;
            cout << "Iteration " << iter + 1 << ": New best cost = "
                 << best_solution.total_cost << ", Routes used = "
                 << best_solution.used_routes << endl;
        } else {
            no_improvement_count++;
        }

        // Update pheromone
        update_pheromone(iteration_solutions);

        // Early termination if no improvement
        if (no_improvement_count >= hybrid_params.restart_threshold) {
            cout << "Early termination at iteration " << iter + 1 << endl;
            break;
        }
    }

    return best_solution;
}

void write_output(const string &filename, const HybridSolution &solution) {
    ofstream file(filename);

    file << "Instance name : " << instance.name << endl;
    file << "Authors       : Pix" << endl;
    file << "Date          : 2025" << endl;
    file << "Reference     : Simplified Hybrid ACO + Pure Greedy" << endl;
    file << "Solution" << endl;

    int route_num = 1;
    for (const auto &route : solution.routes) {
        if (!route.empty()) {
            file << "Route " << route_num << " : ";
            for (int i = 0; i < route.size(); i++) {
                if (i > 0)
                    file << " ";
                file << route[i];
            }
            file << endl;
            route_num++;
        }
    }

    file.close();
}

void solve(const string &input_file, const string &output_file, int num_routes) {
    instance = parse_input(input_file);
    depot = instance.nodes[0];
    pickup_nodes.clear();
    delivery_nodes.clear();

    for (const Node &node : instance.nodes) {
        if (node.is_pickup()) {
            pickup_nodes.push_back(node);
        } else if (node.is_delivery()) {
            delivery_nodes.push_back(node);
        }
    }

    cout << "Instance loaded: " << instance.name << endl;
    cout << "Nodes: " << instance.size << ", Pickup pairs: " << pickup_nodes.size() << endl;
    cout << "Capacity: " << instance.capacity << endl;

    int required_pairs = pickup_nodes.size();
    HybridSolution best_solution(num_routes);
    bool all_pairs_served = false;
    int current_routes = num_routes;

    while (!all_pairs_served && current_routes <= required_pairs * 2) {
        cout << "\nAttempting solution with " << current_routes << " routes..." << endl;

        best_solution = hybrid_aco_solve(current_routes);

        int total_nodes_visited = 0;
        for (const auto &route : best_solution.routes) {
            total_nodes_visited += route.size();
        }
        int pairs_served = total_nodes_visited / 2;

        all_pairs_served = (pairs_served == required_pairs);

        if (!all_pairs_served) {
            cout << "Served " << pairs_served << " out of " << required_pairs
                 << " pairs. Increasing number of routes..." << endl;
            current_routes++;
        }
    }

    if (!all_pairs_served) {
        cout << "WARNING: Could not serve all pairs even with " << current_routes - 1 << " routes." << endl;
    } else {
        cout << "\nAll pairs served successfully using " << best_solution.used_routes << " routes." << endl;
        cout << "Total cost: " << best_solution.total_cost << endl;
    }

    write_output(output_file, best_solution);
    cout << "Solution written to " << output_file << endl;
}

int main(int argc, char *argv[]) {
    string input_file = "input.txt";
    string output_file = "output.txt";

    cout << "Using input file: " << input_file << endl;
    cout << "Using output file: " << output_file << endl;

    // Parse parameters from first line of input file
    int num_routes = parse_parameters_from_input(input_file);

    cout << "Number of routes: " << num_routes << endl;

    solve(input_file, output_file, num_routes);
    return 0;
}
