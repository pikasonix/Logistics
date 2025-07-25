import React, { useState, useEffect } from 'react';

const RouteList = ({
  solution,
  onClickRoute,
  highlightRoute,
  selectedRoute,
  instance,
}) => {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const toggleDropdown = () => {
    setIsDropdownOpen(prev => !prev);
  };

  useEffect(() => {
    // Clear selection when dropdown closes
    if (!isDropdownOpen && selectedRoute) {
      highlightRoute(selectedRoute, false);
    }
  }, [isDropdownOpen, selectedRoute, highlightRoute]);

  if (!solution || !solution.routes || solution.routes.length === 0) {
    return null;
  }

  return (
    <div className="border-b border-gray-200">
      <button
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors duration-200"
        onClick={toggleDropdown}
      >
        <div className="flex items-center space-x-3">
          <i className="fa fa-route text-blue-600"></i>
          <span className="font-medium text-gray-700">Routes</span>
        </div>
        <i className={`fa fa-angle-down text-gray-400 transform transition-transform duration-200 ${isDropdownOpen ? 'rotate-180' : ''}`}></i>
      </button>
      <div
        id="routes_dropdown"
        className={`bg-gray-50 max-h-40 overflow-y-auto ${isDropdownOpen ? 'block' : 'hidden'}`}
      >
        {solution.routes.map((route) => (
          <div key={route.id} className="py-1">
            <button
              className={`dropdown-btn w-full text-left px-4 py-2 text-sm font-medium rounded-lg transition-colors duration-200 ${selectedRoute && selectedRoute.id === route.id ? 'active' : ''}`}
              onClick={() => onClickRoute(route)}
              onMouseEnter={() => {
                if (!selectedRoute) {
                  highlightRoute(route, true);
                }
              }}
              onMouseLeave={() => {
                if (!selectedRoute) {
                  highlightRoute(route, false);
                }
              }}
            >
              Route {route.id + 1} (Cost: {route.cost.toFixed(2)})
            </button>
            <div className="dropdown-container pl-4" style={{ display: selectedRoute && selectedRoute.id === route.id ? 'block' : 'none' }}>
              {route.sequence.map((nodeId, index) => {
                const node = instance.nodes[nodeId];
                let iconClass = '';
                if (node.is_depot) {
                  iconClass = 'depot-icon';
                } else if (node.is_pickup) {
                  iconClass = 'pickup-icon';
                } else if (node.is_delivery) {
                  iconClass = 'delivery-icon';
                }
                return (
                  <a key={node.id + '-' + index} href="#" className="dropdown-content-item flex items-center space-x-2">
                    <i className={`fa fa-circle ${iconClass}`}></i>
                    <span>{node.string_name()}</span>
                  </a>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default RouteList;
