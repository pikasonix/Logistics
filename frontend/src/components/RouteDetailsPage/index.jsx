import React, { useState, useEffect, useRef } from 'react';
import L from 'leaflet';
import config from '../../config/config';

const RouteDetailsPage = ({ solution, instance, useRealRouting, toggleRealRouting, onBack }) => {
    const [selectedRouteId, setSelectedRouteId] = useState('');
    const [routeDetail, setRouteDetail] = useState(null);
    const [clickedCardIndex, setClickedCardIndex] = useState(null);
    const mapRef = useRef(null);
    const mapInstance = useRef(null);

    useEffect(() => {
        // Initialize map when component mounts
        if (mapRef.current && !mapInstance.current) {
            mapInstance.current = L.map(mapRef.current).setView([0, 0], 2);
            L.tileLayer(config.map.tileUrl, {
                maxZoom: 19,
                attribution: config.map.attribution
            }).addTo(mapInstance.current);
        }

        return () => {
            if (mapInstance.current) {
                mapInstance.current.remove();
                mapInstance.current = null;
            }
        };
    }, []);

    // Effect to redraw route when useRealRouting changes
    useEffect(() => {
        if (routeDetail) {
            console.log('Real routing mode changed, redrawing route...');
            displayRouteOnMap(routeDetail);
        }
    }, [useRealRouting]);

    const getDistanceBetweenPoints = (coord1, coord2) => {
        const R = 6371; // Earth's radius in km
        const dLat = (coord2[0] - coord1[0]) * Math.PI / 180;
        const dLon = (coord2[1] - coord1[1]) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(coord1[0] * Math.PI / 180) * Math.cos(coord2[0] * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    };

    // Real routing functionality for route details
    const getRealRoute = async (route) => {
        if (!useRealRouting || !route?.sequence) {
            // Return straight line coordinates when real routing is disabled
            return route.sequence.map(nodeId => instance.nodes[nodeId].coords);
        }

        try {
            // Build OSRM request for full route through all waypoints
            const coordPairs = route.sequence.map(nodeId => {
                const coords = instance.nodes[nodeId].coords;
                return `${coords[1]},${coords[0]}`; // OSRM expects lon,lat
            }).join(';');

            // Get routing profile from localStorage, default to 'walking' for shortest path
            const routingProfile = localStorage.getItem('routingProfile') || 'walking';
            const url = `https://router.project-osrm.org/route/v1/${routingProfile}/${coordPairs}?overview=full&geometries=geojson`;
            console.log('Fetching real route for route details:', route.id, 'using profile:', routingProfile);

            const response = await fetch(url);
            const data = await response.json();

            if (data.routes && data.routes.length > 0) {
                // Convert coordinates from OSRM format (lon,lat) to Leaflet format (lat,lon)
                const routeCoords = data.routes[0].geometry.coordinates.map(coord => [coord[1], coord[0]]);
                console.log('Real route fetched successfully:', routeCoords.length, 'points');
                return routeCoords;
            } else {
                console.warn('No real route found, using straight lines');
                return route.sequence.map(nodeId => instance.nodes[nodeId].coords);
            }
        } catch (error) {
            console.warn('Real routing API error:', error, 'Using straight lines');
            return route.sequence.map(nodeId => instance.nodes[nodeId].coords);
        }
    };

    const calculateTimelineData = (route) => {
        if (!route?.sequence || !instance?.nodes) return null;

        const data = {
            events: [],
            totalDuration: 0,
            totalDistance: 0,
            maxTime: 0
        };

        let currentTime = 0;
        let currentLoad = 0;
        let totalDistance = 0;

        route.sequence.forEach((nodeId, index) => {
            const node = instance.nodes[nodeId];
            let travelTime = 0;
            let distance = 0;

            // Calculate travel time and distance from previous node
            if (index > 0) {
                const prevNodeId = route.sequence[index - 1];
                if (instance.times && instance.times[prevNodeId] && instance.times[prevNodeId][nodeId]) {
                    travelTime = instance.times[prevNodeId][nodeId];
                    distance = instance.distances ? instance.distances[prevNodeId][nodeId] : travelTime * 30;
                } else {
                    // Fallback calculation
                    const prevNode = instance.nodes[prevNodeId];
                    distance = getDistanceBetweenPoints(prevNode.coords, node.coords);
                    travelTime = distance / 30; // 30 km/h average speed
                }
                totalDistance += distance;
            }

            // Arrival time
            const arrivalTime = currentTime + travelTime;

            // Service start time (considering time window)
            let serviceStartTime = arrivalTime;
            const waitTime = Math.max(0, (node.time_window?.[0] || 0) - arrivalTime);
            serviceStartTime = Math.max(arrivalTime, node.time_window?.[0] || 0);

            // Service duration
            const serviceDuration = node.service_time || 0;

            // Update load
            currentLoad += node.demand || 0;

            // Create event
            const event = {
                nodeId: nodeId,
                index: index,
                nodeType: node.is_depot ? 'depot' : node.is_pickup ? 'pickup' : 'delivery',
                arrivalTime: arrivalTime,
                serviceStartTime: serviceStartTime,
                serviceEndTime: serviceStartTime + serviceDuration,
                waitTime: waitTime,
                serviceDuration: serviceDuration,
                travelTime: travelTime,
                distance: distance,
                load: currentLoad,
                timeWindow: [node.time_window?.[0] || 0, node.time_window?.[1] || 0],
                demand: node.demand || 0,
                coords: node.coords
            };

            data.events.push(event);
            currentTime = serviceStartTime + serviceDuration;
        });

        data.totalDuration = currentTime;
        data.totalDistance = totalDistance;
        data.maxTime = Math.max(currentTime, Math.max(...route.sequence.map(nodeId => instance.nodes[nodeId].time_window?.[1] || 0)));

        return data;
    };

    const handleRouteSelect = async (routeId) => {
        if (!routeId || !solution?.routes) return;

        const route = solution.routes.find(r => r.id == routeId);
        if (!route) return;

        setSelectedRouteId(routeId);
        setRouteDetail(route);
        await displayRouteOnMap(route);
    };

    const displaySegmentOnMap = async (fromNodeId, toNodeId) => {
        if (!mapInstance.current || !instance?.nodes) return;

        const fromNode = instance.nodes[fromNodeId];
        const toNode = instance.nodes[toNodeId];

        if (!fromNode || !toNode) return;

        try {
            let segmentCoords;

            if (useRealRouting) {
                // Get real route segment using OSRM
                // Get routing profile from localStorage, default to 'walking' for shortest path
                const routingProfile = localStorage.getItem('routingProfile') || 'walking';
                const coordPairs = `${fromNode.coords[1]},${fromNode.coords[0]};${toNode.coords[1]},${toNode.coords[0]}`;
                const url = `https://router.project-osrm.org/route/v1/${routingProfile}/${coordPairs}?overview=full&geometries=geojson`;

                console.log('Fetching segment route from', fromNodeId, 'to', toNodeId, 'using profile:', routingProfile);
                const response = await fetch(url);
                const data = await response.json();

                if (data.routes && data.routes.length > 0) {
                    segmentCoords = data.routes[0].geometry.coordinates.map(coord => [coord[1], coord[0]]);
                } else {
                    // Fallback to straight line
                    segmentCoords = [fromNode.coords, toNode.coords];
                }
            } else {
                // Use straight line when real routing is disabled
                segmentCoords = [fromNode.coords, toNode.coords];
            }

            // Clear existing highlighted segments
            mapInstance.current.eachLayer((layer) => {
                if (layer.options && layer.options.isSegmentHighlight) {
                    mapInstance.current.removeLayer(layer);
                }
            });

            // Add highlighted segment
            const segmentLine = L.polyline(segmentCoords, {
                color: '#ff4444',
                weight: 6,
                opacity: 0.9,
                isSegmentHighlight: true
            }).addTo(mapInstance.current);

            // Add popup showing segment info
            const distance = getDistanceBetweenPoints(fromNode.coords, toNode.coords);
            segmentLine.bindPopup(`
                <div class="text-sm">
                    <strong>Segment: Node ${fromNodeId} → Node ${toNodeId}</strong><br>
                    Distance: ${distance.toFixed(2)} km<br>
                    Route type: ${useRealRouting ? 'Real routing' : 'Straight line'}
                </div>
            `).openPopup();

            // Fit map to show the segment
            mapInstance.current.fitBounds(segmentLine.getBounds(), { padding: [20, 20] });

        } catch (error) {
            console.error('Error displaying segment:', error);
        }
    };

    const displayRouteOnMap = async (route) => {
        if (!mapInstance.current || !route?.sequence || !instance?.nodes) return;

        // Clear existing layers
        mapInstance.current.eachLayer((layer) => {
            if (layer instanceof L.Polyline || layer instanceof L.Marker) {
                mapInstance.current.removeLayer(layer);
            }
        });

        // Add markers for nodes
        const nodeCoordinates = [];
        route.sequence.forEach((nodeId, index) => {
            const node = instance.nodes[nodeId];
            if (!node) return;

            const [lat, lng] = node.coords;
            nodeCoordinates.push([lat, lng]);

            let iconClass, color;
            if (node.is_depot) {
                iconClass = 'fa-home';
                color = 'blue';
            } else if (node.is_pickup) {
                iconClass = 'fa-upload';
                color = 'green';
            } else {
                iconClass = 'fa-download';
                color = 'red';
            }

            const marker = L.circleMarker([lat, lng], {
                radius: 8,
                color: color,
                fillColor: color,
                fillOpacity: 0.7
            }).addTo(mapInstance.current);

            marker.bindPopup(`
        <strong>Node ${nodeId}</strong><br>
        Type: ${node.is_depot ? 'Depot' : node.is_pickup ? 'Pickup' : 'Delivery'}<br>
        Demand: ${node.demand || 0}<br>
        Time Window: [${node.time_window?.[0] || 0}, ${node.time_window?.[1] || 0}]<br>
        Sequence: ${index + 1}
      `);
        });

        // Get route coordinates (real routing or straight lines)
        const routeCoordinates = await getRealRoute(route);

        // Draw route line
        if (routeCoordinates.length > 1) {
            const routeStyle = useRealRouting
                ? { color: 'blue', weight: 4, opacity: 0.8 }  // Thicker line for real routes
                : { color: 'blue', weight: 3, opacity: 0.6 }; // Thinner line for straight lines

            L.polyline(routeCoordinates, routeStyle).addTo(mapInstance.current);
        }

        // Fit map to show all markers
        if (nodeCoordinates.length > 0) {
            const group = new L.featureGroup();
            nodeCoordinates.forEach(coord => {
                L.marker(coord).addTo(group);
            });
            mapInstance.current.fitBounds(group.getBounds().pad(0.1));
        }
    };

    const calculateRouteMetrics = (route) => {
        if (!route?.sequence || !instance?.nodes) return null;

        let totalDistance = 0;
        for (let i = 1; i < route.sequence.length; i++) {
            const node1 = instance.nodes[route.sequence[i - 1]];
            const node2 = instance.nodes[route.sequence[i]];
            if (node1 && node2) {
                const distance = getDistanceBetweenPoints(node1.coords, node2.coords);
                totalDistance += distance;
            }
        }

        return {
            distance: totalDistance,
            time: totalDistance / 30, // Assume 30 km/h average speed
            nodes: route.sequence.length
        };
    };

    const renderNodeSequence = () => {
        if (!routeDetail?.sequence || !instance?.nodes) return null;

        return routeDetail.sequence.map((nodeId, index) => {
            const node = instance.nodes[nodeId];
            if (!node) return null;

            let iconClass, borderColor, nodeType;
            if (node.is_depot) {
                iconClass = 'fa fa-home text-blue-600';
                borderColor = 'border-blue-500';
                nodeType = 'Depot';
            } else if (node.is_pickup) {
                iconClass = 'fa fa-upload text-green-600';
                borderColor = 'border-green-500';
                nodeType = 'Pickup';
            } else {
                iconClass = 'fa fa-download text-red-600';
                borderColor = 'border-red-500';
                nodeType = 'Delivery';
            }

            return (
                <div
                    key={index}
                    className={`flex items-center space-x-3 p-2 bg-gray-50 rounded border-l-4 mb-2 transition-colors duration-200 ${borderColor}`}
                >
                    <span className="bg-gray-200 text-gray-700 rounded-full w-8 h-8 flex items-center justify-center text-sm font-semibold">
                        {index + 1}
                    </span>
                    <i className={iconClass}></i>
                    <div className="flex-1">
                        <div className="font-medium text-sm">{nodeType} {nodeId}</div>
                        <div className="text-xs text-gray-500">
                            Demand: {node.demand || 0}, TW: [{node.time_window?.[0] || 0}, {node.time_window?.[1] || 0}]
                        </div>
                        <div className="text-xs text-gray-400">
                            Coords: [{node.coords[0].toFixed(4)}, {node.coords[1].toFixed(4)}]
                        </div>
                    </div>
                </div>
            );
        });
    };

    const renderTimeline = () => {
        if (!routeDetail?.sequence || !instance?.nodes) return null;

        const timelineData = calculateTimelineData(routeDetail);
        if (!timelineData) return null;

        return (
            <div className="space-y-4 p-4">
                {/* Timeline Summary */}
                <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4">
                    <h3 className="text-lg font-semibold text-gray-700 mb-3 flex items-center">
                        <i className="far fa-chart-bar mr-2 text-blue-600"></i>
                        Timeline Summary
                    </h3>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                        <div className="bg-blue-50 p-3 rounded-lg border-l-4 border-blue-400">
                            <div className="flex items-center space-x-2">
                                <i className="far fa-clock text-blue-600"></i>
                                <div className="text-blue-600 font-bold text-xl">{timelineData.totalDuration.toFixed(1)}h</div>
                            </div>
                            <div className="text-gray-600 font-medium">Total Duration</div>
                        </div>
                        <div className="bg-green-50 p-3 rounded-lg border-l-4 border-green-400">
                            <div className="flex items-center space-x-2">
                                <i className="fas fa-route text-green-600"></i>
                                <div className="text-green-600 font-bold text-xl">{timelineData.totalDistance.toFixed(1)}km</div>
                            </div>
                            <div className="text-gray-600 font-medium">Total Distance</div>
                        </div>
                    </div>
                </div>

                {/* Timeline Events */}
                <h3 className="text-lg font-semibold text-gray-700 mb-3 flex items-center">
                    <i className="far fa-clock mr-2 text-blue-600"></i>
                    Route Timeline
                </h3>
                <div className="relative">
                    <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-gray-300"></div>
                    {timelineData.events.map((event, index) => {
                        const node = instance.nodes[event.nodeId];
                        if (!node) return null;

                        let markerColor = 'bg-blue-500';
                        let nodeIcon = 'fas fa-home';
                        let nodeLabel = 'Depot';
                        let iconBg = 'bg-blue-100';
                        let borderColor = 'border-blue-400';
                        let hoverBg = 'hover:bg-blue-100';
                        let hoverTextColor = 'hover:text-blue-900';
                        let hoverIconBg = 'hover:bg-blue-300';
                        let activeBg = 'bg-blue-200';
                        let activeTextColor = 'text-blue-900';
                        let activeIconBg = 'bg-blue-400';

                        if (node.is_pickup) {
                            markerColor = 'bg-green-500';
                            nodeIcon = 'fas fa-arrow-up';
                            nodeLabel = 'Pickup';
                            iconBg = 'bg-green-100';
                            borderColor = 'border-green-400';
                            hoverBg = 'hover:bg-green-100';
                            hoverTextColor = 'hover:text-green-900';
                            hoverIconBg = 'hover:bg-green-300';
                            activeBg = 'bg-green-200';
                            activeTextColor = 'text-green-900';
                            activeIconBg = 'bg-green-400';
                        } else if (!node.is_depot) {
                            markerColor = 'bg-red-500';
                            nodeIcon = 'fas fa-arrow-down';
                            nodeLabel = 'Delivery';
                            iconBg = 'bg-red-100';
                            borderColor = 'border-red-400';
                            hoverBg = 'hover:bg-red-100';
                            hoverTextColor = 'hover:text-red-900';
                            hoverIconBg = 'hover:bg-red-300';
                            activeBg = 'bg-red-200';
                            activeTextColor = 'text-red-900';
                            activeIconBg = 'bg-red-400';
                        }

                        // Calculate time window progress
                        const twStart = event.timeWindow[0];
                        const twEnd = event.timeWindow[1];
                        const arrivalTime = event.arrivalTime;
                        const twDuration = twEnd - twStart;
                        const arrivalProgress = twDuration > 0 ? Math.max(0, Math.min(100, ((arrivalTime - twStart) / twDuration) * 100)) : 0;

                        // Determine arrival status
                        let arrivalStatus = 'on-time';
                        let statusColor = 'text-green-600';
                        let statusIcon = 'far fa-check-circle';
                        if (arrivalTime < twStart) {
                            arrivalStatus = 'early';
                            statusColor = 'text-orange-600';
                            statusIcon = 'far fa-clock';
                        } else if (arrivalTime > twEnd) {
                            arrivalStatus = 'late';
                            statusColor = 'text-red-600';
                            statusIcon = 'fas fa-exclamation-triangle';
                        }

                        // Get next event to check for wait time
                        const currentEvent = timelineData.events[index];
                        const hasWaitTime = currentEvent && currentEvent.waitTime > 0;

                        // Check if this card is currently clicked/active
                        const isActive = clickedCardIndex === index;
                        const cardBgClass = isActive ? activeBg : 'bg-white';
                        const cardTextClass = isActive ? activeTextColor : '';
                        const cardIconBgClass = isActive ? activeIconBg : iconBg;

                        return (
                            <div key={index} className="relative flex items-start space-x-4 pb-8">
                                <div className={`w-12 h-12 ${markerColor} rounded-full flex items-center justify-center text-white text-sm font-bold z-10 shadow-lg`}>
                                    {index + 1}
                                </div>
                                <div className="flex-1 space-y-3">
                                    {/* Travel Segment Card (if applicable) */}
                                    {index > 0 && (
                                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center space-x-2">
                                                    <i className="fas fa-route text-blue-600"></i>
                                                    <div className="font-semibold text-blue-800 text-sm">
                                                        <div>Travel:</div>
                                                        <div className="flex items-center space-x-1">
                                                            <span>{timelineData.events[index - 1].nodeId}</span>
                                                            <i className="fas fa-arrow-right text-blue-800"></i>
                                                            <span>{timelineData.events[index].nodeId}</span>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="flex space-x-3 text-sm">
                                                    <div className="text-center">
                                                        <div className="text-blue-600 font-bold">{event.distance.toFixed(1)}km</div>
                                                        <div className="text-xs text-gray-600">Distance</div>
                                                    </div>
                                                    <div className="text-center">
                                                        <div className="text-blue-600 font-bold">{event.travelTime.toFixed(1)}h</div>
                                                        <div className="text-xs text-gray-600">Time</div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* Wait Time Card (for next node if applicable) */}
                                    {hasWaitTime && (
                                        <div className="bg-orange-50 border-l-4 border-orange-400 rounded-lg p-3">
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center space-x-2">
                                                    <i className="far fa-pause-circle text-orange-600"></i>
                                                    <div>
                                                        <div className="font-semibold text-orange-800 text-sm">Wait Required at Next Node</div>
                                                        <div className="text-xs text-orange-600">
                                                            Will arrive early, need to wait {currentEvent.waitTime.toFixed(1)}h
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="bg-orange-200 px-2 py-1 rounded text-orange-800 font-bold text-sm">
                                                    +{currentEvent.waitTime.toFixed(1)}h
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* Main Event Card */}
                                    <div
                                        className={`rounded-lg shadow-sm border-l-4 ${borderColor} p-4 transition-all duration-300 cursor-pointer ${index > 0
                                            ? isActive
                                                ? `${activeBg} ${activeTextColor}`
                                                : `${cardBgClass} ${hoverBg} hover:shadow-lg ${hoverTextColor}`
                                            : ''
                                            }`}
                                        onClick={() => {
                                            if (index > 0) {
                                                // Set active state (persist selection until next click)
                                                setClickedCardIndex(index);

                                                const prevNodeId = timelineData.events[index - 1].nodeId;
                                                displaySegmentOnMap(prevNodeId, event.nodeId);
                                            }
                                        }}
                                        title={index > 0 ? `Click to show path from Node ${timelineData.events[index - 1].nodeId} to Node ${event.nodeId}` : ''}
                                    >
                                        {/* Header */}
                                        <div className="flex items-center justify-between mb-3">
                                            <div className="flex items-center space-x-3">
                                                <div
                                                    className={`w-10 h-10 ${!isActive ? cardIconBgClass : ''} ${!isActive ? hoverIconBg : ''} rounded-full flex items-center justify-center transition-colors duration-300`}
                                                    style={isActive ? {
                                                        backgroundColor: activeIconBg.replace('bg-', '').replace('blue-400', '#60a5fa').replace('green-400', '#4ade80').replace('red-400', '#f87171')
                                                    } : {}}
                                                >
                                                    <i className={`${nodeIcon} text-lg`}></i>
                                                </div>
                                                <div>
                                                    <div className="font-bold text-gray-800 text-lg">Node {event.nodeId}</div>
                                                    <div className="text-sm text-gray-600">{nodeLabel}</div>
                                                </div>
                                            </div>
                                            <div className="flex items-center space-x-2">
                                                <i className={`${statusIcon} ${statusColor}`}></i>
                                                {index > 0 && (
                                                    <i className="fas fa-map-marked-alt text-blue-500" title="Click to show segment path"></i>
                                                )}
                                            </div>
                                        </div>

                                        {/* Time Window Progress Bar */}
                                        <div className="mb-4">
                                            <div className="flex justify-between text-xs text-gray-600 mb-1">
                                                <div>
                                                    <div>Window:</div>
                                                    <div>{twStart}h - {twEnd}h</div>
                                                </div>
                                                <div className={statusColor}>
                                                    <div >Arrive:</div>
                                                    <div>{arrivalTime.toFixed(1)}h ({arrivalStatus})</div>
                                                </div>
                                            </div>
                                            <div className="w-full bg-gray-200 rounded-full h-2">
                                                <div
                                                    className={`h-2 rounded-full ${arrivalStatus === 'early' ? 'bg-orange-400' :
                                                        arrivalStatus === 'late' ? 'bg-red-400' : 'bg-green-400'
                                                        }`}
                                                    style={{ width: `${arrivalProgress}%` }}
                                                ></div>
                                            </div>
                                        </div>

                                        {/* Stats Grid */}
                                        <div className="grid grid-cols-3 gap-3 mb-3">
                                            {/* Service Time */}
                                            <div className="bg-blue-50 p-2 rounded text-center">
                                                <div className="text-blue-600 font-bold text-sm">{event.serviceDuration.toFixed(1)}h</div>
                                                <div className="text-xs text-gray-600">Service</div>
                                            </div>

                                            {/* Demand */}
                                            <div className={`p-2 rounded text-center ${event.demand > 0 ? 'bg-green-50' : event.demand < 0 ? 'bg-red-50' : 'bg-gray-50'}`}>
                                                <div className={`font-bold text-sm ${event.demand > 0 ? 'text-green-600' : event.demand < 0 ? 'text-red-600' : 'text-gray-600'}`}>
                                                    {event.demand > 0 ? '+' : ''}{event.demand}
                                                </div>
                                                <div className="text-xs text-gray-600">Demand</div>
                                            </div>

                                            {/* Current Load */}
                                            <div className="bg-purple-50 p-2 rounded text-center">
                                                <div className="text-purple-600 font-bold text-sm">{event.load}</div>
                                                <div className="text-xs text-gray-600">Load</div>
                                            </div>
                                        </div>

                                        {/* Service Timeline - Simplified */}
                                        <div className="pt-3 border-t border-gray-100">
                                            <div className="text-xs text-gray-600 text-center">
                                                Service: {event.serviceStartTime.toFixed(1)}h - {event.serviceEndTime.toFixed(1)}h
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    };

    const metrics = routeDetail ? calculateRouteMetrics(routeDetail) : null;

    return (
        <div className="flex flex-col h-screen">
            {/* Header with back button */}
            <div className="bg-white border-b border-gray-200 p-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center">
                        <button
                            onClick={onBack}
                            className="flex items-center px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors duration-200 mr-4"
                        >
                            <i className="fas fa-arrow-left mr-2"></i>
                            Quay lại Dashboard
                        </button>
                        <h1 className="text-2xl font-bold text-gray-800">Chi tiết Routes</h1>
                    </div>

                    {/* Real Routing Toggle */}
                    <div className="flex items-center">
                        <button
                            onClick={toggleRealRouting}
                            className={`flex items-center space-x-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors duration-200 ${useRealRouting
                                ? 'bg-green-600 hover:bg-green-700 text-white'
                                : 'bg-gray-600 hover:bg-gray-700 text-white'
                                }`}
                        >
                            <i className={`fas ${useRealRouting ? 'fa-route' : 'fa-map-marked-alt'}`}></i>
                            <span>{useRealRouting ? 'Tắt đường thực tế' : 'Bật đường thực tế'}</span>
                        </button>
                    </div>
                </div>
            </div>

            <div className="flex flex-1 overflow-hidden">
                {/* Route List Sidebar */}
                <div className="w-80 bg-white shadow-xl border-r border-gray-200 flex flex-col overflow-hidden">
                    <div className="bg-blue-600 text-white p-4">
                        <div className="flex items-center space-x-3">
                            <i className="fas fa-route text-xl"></i>
                            <h2 className="text-lg font-semibold">Route Selector</h2>
                        </div>
                    </div>

                    {/* Route Selection */}
                    <div className="p-4 border-b border-gray-200">
                        <div className="space-y-3">
                            <label className="text-sm font-medium text-gray-700">Chọn Route để xem chi tiết:</label>
                            <select
                                value={selectedRouteId}
                                onChange={(e) => handleRouteSelect(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                                <option value="">-- Chọn Route --</option>
                                {solution?.routes?.map((route, index) => (
                                    <option key={index} value={route.id || index}>
                                        Route {(route.id || index) + 1} (Cost: {route.cost || 'N/A'})
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* Route Summary */}
                    {routeDetail && metrics && (
                        <div className="p-4 border-b border-gray-200">
                            <h3 className="text-sm font-semibold text-gray-700 mb-3">Thông tin tổng quan:</h3>
                            <div className="space-y-2">
                                <div className="flex justify-between text-sm">
                                    <span className="text-gray-600">Tổng chi phí:</span>
                                    <span className="font-medium">{routeDetail.cost || 'N/A'}</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-gray-600">Số điểm:</span>
                                    <span className="font-medium">{metrics.nodes}</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-gray-600">Tổng khoảng cách:</span>
                                    <span className="font-medium">{metrics.distance.toFixed(2)} km</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-gray-600">Thời gian thực hiện:</span>
                                    <span className="font-medium">{metrics.time.toFixed(1)} h</span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Node Sequence */}
                    <div className="flex-1 overflow-y-auto">
                        <div className="p-4">
                            <h3 className="text-sm font-semibold text-gray-700 mb-3">Trình tự các điểm:</h3>
                            <div className="space-y-2">
                                {renderNodeSequence()}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Route Detail Map */}
                <div className="flex-1 bg-gray-50">
                    <div ref={mapRef} className="w-full h-full"></div>
                </div>

                {/* Route Timeline Sidebar */}
                <div className="w-80 bg-white border-l border-gray-200 flex flex-col overflow-hidden">
                    <div className="bg-purple-600 text-white p-4">
                        <div className="flex items-center space-x-3">
                            <i className="fas fa-clock text-xl"></i>
                            <h3 className="text-lg font-semibold">Timeline Route</h3>
                        </div>
                    </div>
                    <div className="flex-1 overflow-y-auto">
                        {renderTimeline()}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default RouteDetailsPage;
