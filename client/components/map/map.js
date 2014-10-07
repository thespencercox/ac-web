/* js-hint hacks. */
/* jshint unused:false  */
/* global L, leafletPip */
'use strict';

angular.module('acMap', ['constants', 'ngAnimate'])

    .controller('mapController', function ($scope, $rootScope, $http, $timeout, $window, $location, acImageCache, ENV) {
        angular.extend($scope, {
            env: ENV,
            current: {},
            drawer: {
                visible: false
            }
        });

        $http.get('api/forecasts').then(function (res) {
            $scope.regions = res.data;
            var dangerIcons = _.map($scope.regions.features, function (r) {
                return r.properties.dangerIconUrl;
            });
            acImageCache.cache(dangerIcons);
        });

        $scope.showMore = function () {
            $rootScope.pageClass = 'page-down';
            $location.path('/more');
        };

        function fetchForecast(region){
            if (region.feature.properties.forecastUrl) {
                $http.get(region.feature.properties.forecastUrl).then(function (res) {
                    region.feature.properties.forecast = res.data;
                });
            }
        }

        $scope.$watch('current.region', function (newRegion, oldRegion) {
            if(newRegion && newRegion !== oldRegion) {
                $scope.drawer.visible = false;
                $scope.imageLoaded = false;

                if(!newRegion.feature.properties.forecast) {
                    fetchForecast(newRegion);
                }

                $timeout(function () {
                    $scope.drawer.visible = true;
                }, 800);
            }
        });

        function setState() {
            var width = $($window).width();

            $timeout(function () {
                if(width < 480) {
                    $scope.deviceSize = 'xs';
                } else if(width >= 480 && width < 600) {
                    $scope.deviceSize = 'sm';
                } else if(width >= 600 && width < 1025) {
                    $scope.deviceSize = 'md';
                } else {
                    $scope.deviceSize = 'lg'
                }
            }, 0);
        }

        angular.element($window).bind('resize', setState);

        setState();

    })

    .directive('acMapboxMap', function ($rootScope, $http, $timeout, $document, $window) {
        return {
            template: '<div id="map"></div>',
            replace: true,
            scope: {
                mapboxAccessToken: '@',
                mapboxMapId: '@',
                region: '=',
                regions: '='
            },
            link: function ($scope, el, attrs) {
                var layers = {
                    dangerIcons: L.featureGroup()
                };
                var styles = {
                    region: {
                        default: {
                            fillColor: 'transparent',
                            color: 'transparent'
                        },
                        selected: {
                            fillColor: '#489BDF'
                        }
                    }
                };

                L.mapbox.accessToken = $scope.mapboxAccessToken;
                var map = L.mapbox.map(el[0].id, $scope.mapboxMapId, {attributionControl: false});

                function invalidateSize() {
                    el.height($($window).height()-75);
                    map.invalidateSize();
                }

                angular.element(document).ready(invalidateSize);
                angular.element($window).bind('resize', invalidateSize);

                map.on('moveend', function () {
                    if(map.getZoom() <= 6 && map.hasLayer(layers.dangerIcons)) {
                        map.removeLayer(layers.dangerIcons);
                    } else if (map.getZoom() > 6 && !map.hasLayer(layers.dangerIcons)){
                        map.addLayer(layers.dangerIcons);
                    }
                });

                function offsetLatLng(latlng){
                    var offset = getMapOffset();
                    var points = map.latLngToLayerPoint(latlng);
                    return map.layerPointToLatLng(points.add(offset));
                }

                function getMapPadding(){
                    var mapWidth = map.getSize().x;

                    if(mapWidth > 1025) {
                        return [480, 0];
                    } else if (mapWidth > 600) {
                        return [350, 0];
                    } else {
                        return [0, 0];
                    }
                }

                function getMapOffset(){
                    var mapPadding = getMapPadding();
                    return [mapPadding[0]/2, mapPadding[1]];
                }

                function getPaddedMapCenter(){
                    var mapCenterPoint = map.latLngToLayerPoint(map.getCenter()).subtract(getMapOffset());
                    return map.layerPointToLatLng(mapCenterPoint);
                }

                function setRegionFocus() {
                    if(map.getZoom() >= 9) {
                        var centerRegion;
                        var centerRegions = [];
                        var paddedMapCenter = getPaddedMapCenter();
                        var centerPoint = map.latLngToLayerPoint(paddedMapCenter);
                        var centerBounds = L.bounds([centerPoint.x-50, centerPoint.y-50], [centerPoint.x+50, centerPoint.y+50]);
                        var nw = map.layerPointToLatLng(centerBounds.max);
                        var se = map.layerPointToLatLng(centerBounds.min);
                        var centerLatLngBounds = L.latLngBounds(nw, se);

                        // find every regions which intersects map center bounds (100px square)
                        layers.regions.eachLayer(function (region) {
                            if (region.getBounds().intersects(centerLatLngBounds)) {
                                centerRegions.push(region);
                            }
                        });

                        // if there is more than one region look if one is within map bounds
                        if(centerRegions.length > 1) {
                            centerRegion =  _.find(centerRegions, function (region) {
                                return map.getBounds().contains(region.getBounds());
                            });
                        } else if (centerRegions.length === 1) { // otherwise select the one
                            centerRegion = centerRegions[0];
                        }

                        // more than one region return; get the one which contains the map center
                        if(!centerRegion && centerRegions.length > 1) {
                            centerRegion = leafletPip.pointInLayer(getPaddedMapCenter(), layers.regions, true)[0];
                        }

                        $scope.$apply(function () {
                            $scope.region = centerRegion;
                        });
                    }
                }

                map.on('dragend', setRegionFocus);
                map.on('zoomend', setRegionFocus);

                $scope.$watch('region', function (region) {
                    if(region) {
                        layers.regions.eachLayer(function (layer) {
                            var style = (layer === region ? styles.region.selected : styles.region.default);
                            layer.setStyle(style);
                        });
                    }
                });

                $scope.$watch('regions', function (regions) {
                    if(regions && regions.features) {

                        layers.regions = L.geoJson($scope.regions, {
                            style: function(feature) {
                                return styles.region.default;
                            },
                            onEachFeature: function (featureData, layer) {
                                layer.bindLabel(featureData.properties.name, {noHide: true});

                                function showRegion(evt){
                                    if(map.getZoom() < 9) {
                                        map.fitBounds(layer.getBounds(), { paddingBottomRight: getMapPadding() });
                                    } else {
                                        map.panTo(offsetLatLng(evt.latlng));
                                    }

                                    $scope.$apply(function () {
                                        $scope.region = layer;
                                    });
                                }

                                layer.on('click', showRegion);

                                if(featureData.properties.centroid) {
                                    var centroid = L.latLng(featureData.properties.centroid[1], featureData.properties.centroid[0]);
                                    layer.feature.properties.centroid = centroid;

                                    L.marker(centroid, {
                                        icon: L.icon({
                                            iconUrl: featureData.properties.dangerIconUrl,
                                            iconSize: [80, 80]
                                        })
                                    }).on('click', showRegion).addTo(layers.dangerIcons);
                                }

                            }
                        }).addTo(map);
                    }
                });
            }
        };
    })

    .factory('acImageCache', function ($http) {
        return {
            cache: function (images) {
                images.forEach(function (i) {
                    $http.get(i);
                });
            }
        };
    })

    .directive('acDrawer', function () {
        return {
            replace: true,
            transclude: true,
            templateUrl: 'components/map/drawer.html',
            link: function ($scope, el, attrs) {
                el.addClass('ac-drawer');
            }
        };
    })

    .directive('acForecastMini', function () {
        return {
            templateUrl: 'components/forecast/forecast-mini.html',
            scope: {
                forecast: '=acForecast'
            },
            link: function ($scope, el, attrs) {
                el.addClass('ac-forecast-mini');
            }
        };
    })

    .directive('imageLoading', function () {
        return function ($scope, el, attrs) {
            angular.element(el).bind('load', function () {
                $scope.imageLoaded = true;
                $scope.$apply();
            });

            attrs.$observe('ngSrc', function () {
                $scope.imageLoaded = false;
            });
        };
    })

    .filter('sanatizeHtml', function () {
        return function (item) {
            if (item) {
                return item.replace(/!_!/g, '').replace(/<style[\s\S]*<\/style>/g, '');
            }
        };
    })

    .filter('normalizeForecastTitle', function () {
        return function (item) {
            if (item) {
                return item.replace(/^Avalanche (Forecast|Bulletin) - /g, '');
            }
        };
    });