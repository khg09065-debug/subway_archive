import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import axios from 'axios';
import './App.css';
import BrandAnalyzer from './BrandAnalyzer';
import { lineColors, clusterInfo, brandCategories, tileLayers } from './constants';
import { bridgeWaypoints, isStraightSegment } from './bridgeWaypoints';

function App() {
    const mapRef = useRef(null);
    const mapInstance = useRef(null);
    const layerGroupRef = useRef(null);
    const polylineGroupRef = useRef(null);
    const tileLayerRef = useRef(null);

    const [allStations, setAllStations] = useState([]);
    const [displayStations, setDisplayStations] = useState([]);
    const [regions, setRegions] = useState([]);
    const [selectedStation, setSelectedStation] = useState(null);
    const [filterRegion, setFilterRegion] = useState('');
    const [mapMode, setMapMode] = useState('dark');
    const [activeAnalysisBrand, setActiveAnalysisBrand] = useState(null);

    const getBezierPoints = (p1, p2, waypoint = null, isWeak = false) => {
        const start = [p1.위도, p1.경도];
        const end = [p2.위도, p2.경도];
        if (Array.isArray(waypoint) && Array.isArray(waypoint[0])) return [start, ...waypoint, end];

        const points = [];
        const count = 40;
        let cp;
        if (waypoint) {
            const weight = isWeak ? 1.5 : 2.0; 
            cp = [weight * waypoint[0] - (weight - 1) * 0.5 * (start[0] + end[0]), weight * waypoint[1] - (weight - 1) * 0.5 * (start[1] + end[1])];
        } else {
            cp = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
        }

        for (let i = 0; i <= count; i++) {
            const t = i / count;
            const lat = (1 - t) * (1 - t) * start[0] + 2 * (1 - t) * t * cp[0] + t * t * end[0];
            const lon = (1 - t) * (1 - t) * start[1] + 2 * (1 - t) * t * cp[1] + t * t * end[1];
            points.push([lat, lon]);
        }
        return points;
    };

    useEffect(() => {
        axios.get('http://localhost:8000/api/stations')
            .then(res => {
                const renamedData = res.data.map(st => ({
                    ...st,
                    역명: st.역명 === '이수' ? '총신대입구' : st.역명
                }));
                const sortedData = renamedData.sort((a, b) => String(a.역번호).localeCompare(String(b.역번호)));
                setAllStations(sortedData);
                setRegions(['전체', ...new Set(renamedData.map(item => item.지역))]);
            })
            .catch(err => console.error(err));
    }, []);

    useEffect(() => {
        let filtered = filterRegion === '전체' ? allStations :
                      filterRegion !== '' ? allStations.filter(st => st.지역 === filterRegion) : [];
        setDisplayStations(filtered);
        setSelectedStation(null);

        if (!activeAnalysisBrand && filtered.length > 0 && mapInstance.current) {
            const lats = filtered.map(s => s.위도);
            const lons = filtered.map(s => s.경도);
            mapInstance.current.fitBounds(L.latLngBounds([Math.min(...lats), Math.min(...lons)], [Math.max(...lats), Math.max(...lons)]).pad(0.1));
        }
    }, [filterRegion, allStations, activeAnalysisBrand]);

    useEffect(() => {
        if (activeAnalysisBrand) {
            if (mapInstance.current) {
                mapInstance.current.remove();
                mapInstance.current = null;
            }
            return;
        }

        if (!mapRef.current) return;
        if (!mapInstance.current) {
            mapInstance.current = L.map(mapRef.current).setView([37.5, 127.0], 12);
            polylineGroupRef.current = L.layerGroup().addTo(mapInstance.current);
            layerGroupRef.current = L.layerGroup().addTo(mapInstance.current);
        }
        if (tileLayerRef.current) mapInstance.current.removeLayer(tileLayerRef.current);
        tileLayerRef.current = L.tileLayer(tileLayers[mapMode]).addTo(mapInstance.current);
    }, [mapMode, activeAnalysisBrand]);

    useEffect(() => {
        if (!mapInstance.current || activeAnalysisBrand) return;

        layerGroupRef.current.clearLayers();
        polylineGroupRef.current.clearLayers();

        const visibleKeys = new Set(displayStations.map(s => s.역명 + s.노선명));
        const lineNames = [...new Set(allStations.map(s => s.노선명))];

        lineNames.forEach(lineName => {
            const stationsInLine = allStations
                .filter(s => s.노선명 === lineName)
                .sort((a, b) => String(a.역번호).localeCompare(String(b.역번호)));

            const color = lineColors[lineName] || '#9CA3AF';

            for (let i = 0; i < stationsInLine.length - 1; i++) {
                const s1 = stationsInLine[i];
                const s2 = stationsInLine[i + 1];
                
                if (!visibleKeys.has(s1.역명 + s1.노선명) || !visibleKeys.has(s2.역명 + s2.노선명)) continue;

                const dist = Math.sqrt(Math.pow(s1.위도 - s2.위도, 2) + Math.pow(s1.경도 - s2.경도, 2));
                
                const isNaturalConnection = (s1.역명 === '별내별가람' && s2.역명 === '오남') || (s1.역명 === '오남' && s2.역명 === '진접');
                const isException = 
                    ((s1.역명 === '오목천' && s2.역명 === '어천')) || 
                    ((s1.역명 === '마곡나루' && s2.역명 === '디지털미디어시티')) ||
                    ((s1.역명 === '강촌' && s2.역명 === '김유정'));

                const relaxedLines = ['경강선', '경춘선', '공항철도', '경의중앙선', '수인분당선', '동해선', '대경선', '우이신설선', '4호선'];
                const maxDist = relaxedLines.includes(lineName) ? 0.8 : 0.05;

                // [최종 수정] 경의중앙선에서 홍대입구-서울역 직통 구간만 제거
                // 신촌(경의중앙선)-서울역 연결은 stationsInLine의 순서에 따라 보존됨
                if (lineName === '경의중앙선' && 
                    ((s1.역명 === '홍대입구' && s2.역명 === '서울역') || (s2.역명 === '홍대입구' && s1.역명 === '서울역'))) {
                    continue;
                }

                if (dist > maxDist && !isException && !isNaturalConnection) continue;

                const pairKey = `${s1.역명}-${s2.역명}`;
                const bridgePoint = bridgeWaypoints[pairKey] || bridgeWaypoints[`${s2.역명}-${s1.역명}`];
                let points;

                if (bridgePoint && (isStraightSegment(pairKey) || Array.isArray(bridgePoint[0]))) {
                    points = Array.isArray(bridgePoint[0]) ? [[s1.위도, s1.경도], ...bridgePoint, [s2.위도, s2.경도]] : [[s1.위도, s1.경도], bridgePoint, [s2.위도, s2.경도]];
                } else if (bridgePoint) {
                    const isWeak = pairKey.includes("상도") || pairKey.includes("장승배기") || pairKey.includes("구의") || pairKey.includes("강변") || pairKey.includes("한양대") || pairKey.includes("뚝섬");
                    points = getBezierPoints(s1, s2, bridgePoint, isWeak);
                } else {
                    points = [[s1.위도, s1.경도], [s2.위도, s2.경도]];
                }

                L.polyline(points, { color, weight: 3, opacity: 0.6, smoothFactor: 1.5, lineJoin: 'round' }).addTo(polylineGroupRef.current);
            }

            // 분기점 로직
            const findVis = (name) => stationsInLine.find(s => s.역명 === name && visibleKeys.has(s.역명 + s.노선명));
            if (lineName === '1호선') {
                const guro = findVis('구로'), guil = findVis('구일'), gasan = findVis('가산디지털단지');
                if (guro && guil) L.polyline(getBezierPoints(guro, guil), {color, weight:3, opacity:0.6}).addTo(polylineGroupRef.current);
                if (guro && gasan) L.polyline(getBezierPoints(guro, gasan), {color, weight:3, opacity:0.6}).addTo(polylineGroupRef.current);
            }
            if (lineName === '2호선') {
                const cjr = findVis('충정로'), sc = findVis('시청'), sd = findVis('신도림'), dt = findVis('도림천'), ss = findVis('성수'), yd = findVis('용답');
                if (cjr && sc) L.polyline(getBezierPoints(cjr, sc), {color, weight:3, opacity:0.6}).addTo(polylineGroupRef.current);
                if (sd && dt) L.polyline(getBezierPoints(sd, dt), {color, weight:3, opacity:0.6}).addTo(polylineGroupRef.current);
                if (ss && yd) L.polyline(getBezierPoints(ss, yd), {color, weight:3, opacity:0.6}).addTo(polylineGroupRef.current);
            }
            if (lineName === '5호선') {
                const gd = findVis('강동'), gildong = findVis('길동'), dc = findVis('둔촌동');
                if (gd && gildong) L.polyline(getBezierPoints(gd, gildong), {color, weight:3, opacity:0.6}).addTo(polylineGroupRef.current);
                if (gd && dc) L.polyline(getBezierPoints(gd, dc), {color, weight:3, opacity:0.6}).addTo(polylineGroupRef.current);
            }
            if (lineName === '경의중앙선') {
                const gj = findVis('가좌'), sc = findVis('신촌'), hd = findVis('홍대입구');
                if (gj && sc) L.polyline(getBezierPoints(gj, sc), {color, weight:3, opacity:0.6}).addTo(polylineGroupRef.current);
                if (gj && hd) L.polyline(getBezierPoints(gj, hd), {color, weight:3, opacity:0.6}).addTo(polylineGroupRef.current);
            }
        });

        displayStations.forEach(st => {
            const squareIcon = L.divIcon({
                className: 'custom-square-marker',
                html: `<div style="background-color: ${lineColors[st.노선명]}; border: 2px solid #fff; width: 10px; height: 10px;"></div>`,
                iconSize: [12, 12], iconAnchor: [6, 6]
            });
            L.marker([st.위도, st.경도], { icon: squareIcon }).addTo(layerGroupRef.current).on('click', () => setSelectedStation(st));
        });
    }, [displayStations, allStations, activeAnalysisBrand]);

    const handleLineChange = (lineName) => {
        const targetData = allStations.find(s => s.역명 === selectedStation.역명 && s.지역 === selectedStation.지역 && s.노선명 === lineName);
        if (targetData) setSelectedStation(targetData);
    };

    return (
        <div className={`dashboard-container mode-${mapMode}`}>
            <div className="sidebar">
                <div className="sidebar-top">
                    <h1>전국 역세권 상권분석</h1>
                    <div className="region-tabs">
                        {regions.map(r => (<button key={r} className={filterRegion === r ? 'active' : ''} onClick={() => setFilterRegion(r)}>{r}</button>))}
                    </div>
                    <div className="content-area">
                        {selectedStation ? (
                            <div className="detail-pill">
                                <div className="badge-container">
                                    {allStations.filter(s => s.역명 === selectedStation.역명 && s.지역 === selectedStation.지역).map(s => (
                                        <button key={s.노선명} className={`line-badge-btn ${selectedStation.노선명 === s.노선명 ? 'active' : ''}`} style={{ borderColor: lineColors[s.노선명] }} onClick={() => handleLineChange(s.노선명)}>{s.노선명}</button>
                                    ))}
                                </div>
                                <h2>{selectedStation.역명}</h2>
                                <div className="cluster-tag">{clusterInfo[selectedStation.클러스터].name}</div>
                                <div className="info-grid">
                                    <div className="info-item"><span>승하차객</span><strong>{selectedStation.총_승하차객수?.toLocaleString()}</strong></div>
                                    <div className="info-item"><span>브랜드 밀도</span><strong>{selectedStation.브랜드_밀도}</strong></div>
                                    <div className="info-item"><span>프리미엄 비율</span><strong className="text-premium">{(selectedStation.프리미엄_비율 * 100).toFixed(0)}%</strong></div>
                                    <div className="info-item"><span>가성비 비율</span><strong className="text-budget">{(selectedStation.가성비_비율 * 100).toFixed(0)}%</strong></div>
                                </div>
                                <button className="reset-pill-btn" onClick={() => setSelectedStation(null)}>가이드 보기</button>
                            </div>
                        ) : (
                            <div className="guide-area">
                                <div className="guide-pill">
                                    <h3>📊 상권 클러스터 유형</h3>
                                    {Object.entries(clusterInfo).map(([key, info]) => (
                                        <div key={key} className="guide-item">
                                            <b className="cluster-label">Type {key}</b>: <span>{info.name}</span>
                                            <p>{info.desc}</p>
                                        </div>
                                    ))}
                                </div>
                                <div className="guide-pill">
                                    <h3>☕ 브랜드 상세 분석</h3>
                                    <div className="brand-button-container">
                                        <div className="brand-col">
                                            <span className="col-label premium">Premium</span>
                                            {brandCategories.premium.map(brand => (<button key={brand} className="brand-tag-btn" onClick={() => setActiveAnalysisBrand(brand)}>{brand}</button>))}
                                        </div>
                                        <div className="brand-col">
                                            <span className="col-label budget">Value</span>
                                            {brandCategories.value.map(brand => (<button key={brand} className="brand-tag-btn" onClick={() => setActiveAnalysisBrand(brand)}>{brand}</button>))}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
                <div className="sidebar-bottom">
                    <div className="mode-toggle">
                        <button className={mapMode === 'light' ? 'active' : ''} onClick={() => setMapMode('light')}>Light</button>
                        <div className="toggle-divider"></div>
                        <button className={mapMode === 'dark' ? 'active' : ''} onClick={() => setMapMode('dark')}>Dark</button>
                    </div>
                </div>
            </div>
            <div className="main-display-area">
                {activeAnalysisBrand ? (
                    <BrandAnalyzer brand={activeAnalysisBrand} mode={mapMode} onClose={() => setActiveAnalysisBrand(null)} />
                ) : (
                    <div ref={mapRef} className="map-area" />
                )}
            </div>
        </div>
    );
}

export default App;