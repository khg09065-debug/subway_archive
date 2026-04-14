import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import axios from 'axios';
import './App.css';
import BrandAnalyzer from './BrandAnalyzer';
import { lineColors, brandCategories, tileLayers } from './constants'; 
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

    // [추가] 캣멀-롬 스플라인: 점들을 부드럽게 잇는 알고리즘
    const getSmoothPath = (points, segments = 12) => {
        if (points.length < 2) return points;
        if (points.length === 2) return points; // 단순 직선

        const result = [];
        // 가상의 제어점 추가 (시작과 끝의 곡률 처리)
        const p = [
            [2 * points[0][0] - points[1][0], 2 * points[0][1] - points[1][1]],
            ...points,
            [2 * points[points.length-1][0] - points[points.length-2][0], 2 * points[points.length-1][1] - points[points.length-2][1]]
        ];

        for (let i = 0; i < p.length - 3; i++) {
            for (let t = 0; t <= 1; t += 1 / segments) {
                const t2 = t * t;
                const t3 = t2 * t;
                const lat = 0.5 * (
                    (2 * p[i+1][0]) +
                    (-p[i][0] + p[i+2][0]) * t +
                    (2 * p[i][0] - 5 * p[i+1][0] + 4 * p[i+2][0] - p[i+3][0]) * t2 +
                    (-p[i][0] + 3 * p[i+1][0] - 3 * p[i+2][0] + p[i+3][0]) * t3
                );
                const lng = 0.5 * (
                    (2 * p[i+1][1]) +
                    (-p[i][1] + p[i+2][1]) * t +
                    (2 * p[i][1] - 5 * p[i+1][1] + 4 * p[i+2][1] - p[i+3][1]) * t2 +
                    (-p[i][1] + 3 * p[i+1][1] - 3 * p[i+2][1] + p[i+3][1]) * t3
                );
                result.push([lat, lng]);
            }
        }
        return result;
    };

    // [기존 기능 유지] 데이터 로드 및 초기화
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
        const renderedSegments = new Set();

        // [핵심 수정] 선 그리기 함수: bridgeWaypoints를 곡선으로 처리
        const drawLine = (s1, s2, color) => {
            if (!s1 || !s2) return;
            const segmentKey = [s1.역명, s2.역명].sort().join('|') + color;
            if (renderedSegments.has(segmentKey)) return;

            const pairKey = `${s1.역명}-${s2.역명}`;
            const bridgePoint = bridgeWaypoints[pairKey] || bridgeWaypoints[`${s2.역명}-${s1.역명}`];
            
            let rawPoints = [[s1.위도, s1.경도]];
            if (bridgePoint) {
                if (Array.isArray(bridgePoint[0])) rawPoints.push(...bridgePoint);
                else rawPoints.push(bridgePoint);
            }
            rawPoints.push([s2.위도, s2.경도]);

            let finalPoints;
            // 직선 구간 설정이 되어있으면 그대로, 아니면 부드러운 곡선 적용
            if (bridgePoint && isStraightSegment(pairKey)) {
                finalPoints = rawPoints;
            } else {
                finalPoints = getSmoothPath(rawPoints);
            }

            L.polyline(finalPoints, { color, weight: 3, opacity: 0.6, smoothFactor: 1, lineJoin: 'round' }).addTo(polylineGroupRef.current);
            renderedSegments.add(segmentKey);
        };

        lineNames.forEach(lineName => {
            const stationsInLine = allStations
                .filter(s => s.노선명 === lineName)
                .sort((a, b) => String(a.역번호).localeCompare(String(b.역번호)));

            const color = lineColors[lineName] || '#9CA3AF';

            // 기본 노선 연결
            for (let i = 0; i < stationsInLine.length - 1; i++) {
                const s1 = stationsInLine[i];
                const s2 = stationsInLine[i + 1];
                if (!visibleKeys.has(s1.역명 + s1.노선명) || !visibleKeys.has(s2.역명 + s2.노선명)) continue;

                const dist = Math.sqrt(Math.pow(s1.위도 - s2.위도, 2) + Math.pow(s1.경도 - s2.경도, 2));
                const isNaturalConnection = (s1.역명 === '별내별가람' && s2.역명 === '오남') || (s1.역명 === '오남' && s2.역명 === '진접');
                const isException = ((s1.역명 === '오목천' && s2.역명 === '어천')) || ((s1.역명 === '마곡나루' && s2.역명 === '디지털미디어시티')) || ((s1.역명 === '강촌' && s2.역명 === '김유정'));
                const relaxedLines = ['경강선', '경춘선', '공항철도', '경의중앙선', '수인분당선', '동해선', '대경선', '우이신설선', '4호선'];
                const maxDist = relaxedLines.includes(lineName) ? 0.8 : 0.05;

                if (lineName === '1호선' && ((s1.역명 === '석수' && s2.역명 === '광명') || (s1.역명 === '광명' && s2.역명 === '석수'))) continue;
                if (lineName === '경의중앙선' && ((s1.역명 === '홍대입구' && s2.역명 === '서울역') || (s2.역명 === '홍대입구' && s1.역명 === '서울역'))) continue;
                if (dist > maxDist && !isException && !isNaturalConnection) continue;

                drawLine(s1, s2, color);
            }

            // 분기점 및 인공적 연결 로직 (부드러운 선 적용됨)
            const findVis = (name) => stationsInLine.find(s => s.역명 === name && visibleKeys.has(s.역명 + s.노선명));
            if (lineName === '1호선') { 
                drawLine(findVis('구로'), findVis('구일'), color); 
                drawLine(findVis('구로'), findVis('가산디지털단지'), color); 
                drawLine(findVis('연천'), findVis('전곡'), color); 
                drawLine(findVis('금천구청'), findVis('석수'), color);
                drawLine(findVis('평택'), findVis('성환'), color);
                drawLine(findVis('온양온천'), findVis('신창'), color);
            }
            if (lineName === '2호선') { 
                drawLine(findVis('충정로'), findVis('시청'), color); 
                drawLine(findVis('신도림'), findVis('도림천'), color); 
                drawLine(findVis('성수'), findVis('용답'), color); 
            }
            if (lineName === '5호선') { 
                drawLine(findVis('강동'), findVis('길동'), color); 
                drawLine(findVis('강동'), findVis('둔촌동'), color); 
            }
            if (lineName === '6호선') { 
                drawLine(findVis('구산'), findVis('응암'), color); 
            }
            if (lineName === '경의중앙선') { 
                drawLine(findVis('가좌'), findVis('신촌'), color); 
                drawLine(findVis('가좌'), findVis('홍대입구'), color);
            }
            if (lineName === '김포골드라인') { 
                drawLine(findVis('김포공항'), findVis('고촌'), color); 
            }
            if (lineName === '신분당선') { 
                drawLine(findVis('청계산입구'), findVis('판교'), color); 
            }
            if (lineName === '서해선') { 
                drawLine(findVis('능곡'), findVis('김포공항'), color); 
            }
        });

        // 마커 렌더링
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
                                <div className="cluster-tag analysis-tag">
                                    {selectedStation.상권_성격 ? selectedStation.상권_성격.replace(/\s*\(.*?\)/, "") : ""}
                                </div>
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
                                    <h3>📊 고도화된 상권 분류 모델</h3>
                                    <div className="guide-item">
                                        <b className="cluster-label">Type 0. 초대형 핵심 광역 상권</b>
                                        <p>유동인구가 압도적으로 많고 브랜드 밀도가 전국 최상위권에 해당하며, 광역 단위의 소비가 일어나는 중심 상권입니다.</p>
                                    </div>
                                    <div className="guide-item">
                                        <b className="cluster-label">Type 1. 고급/오피스 프리미엄 상권</b>
                                        <p>비즈니스 지구를 중심으로 직장인 수요가 많으며, 프리미엄 브랜드에 대한 선호도와 밀집도가 높은 지역입니다.</p>
                                    </div>
                                    <div className="guide-item">
                                        <b className="cluster-label">Type 2. 생활 밀착형 활성 상권</b>
                                        <p>대학가나 주거 밀집 지역 인근의 번화가로, 가성비 브랜드가 촘촘하게 배치되어 소비 활동이 매우 활발한 상권입니다.</p>
                                    </div>
                                    <div className="guide-item">
                                        <b className="cluster-label">Type 3. 저밀도 주거/교외 상권</b>
                                        <p>상업 시설의 밀집도보다는 주거 환경이나 교통 거점으로서의 기능이 강하며, 필수적인 브랜드 위주로 구성된 지역입니다.</p>
                                    </div>
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