from flask import Flask, jsonify, request
from flask_cors import CORS
import pandas as pd
import numpy as np
from sqlalchemy import create_engine
from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler
from math import radians, cos, sin, asin, sqrt
import os
from dotenv import load_dotenv

# .env 파일 로드
load_dotenv()

app = Flask(__name__)
CORS(app)

# --- [환경 설정] ---
DB_HOST = os.getenv("DB_HOST", "localhost")
DB_USER = os.getenv("DB_USER", "root")
DB_PASS = os.getenv("DB_PASSWORD", "1234")
DB_NAME = os.getenv("DB_NAME", "coffee_store")

# SQLAlchemy 엔진 생성
engine = create_engine(f'mysql+pymysql://{DB_USER}:{DB_PASS}@{DB_HOST}:3306/{DB_NAME}')

premium_brands = ['스타벅스', '투썸플레이스', '폴바셋', '할리스', '파스쿠찌', '공차', '디저트39']
budget_brands = ['메가커피', '빽다방', '컴포즈커피', '더벤티', '메머드커피', '이디야', '던킨도너츠', '하삼동커피']

# --- [유틸리티] 거리 계산 함수 ---
def haversine(lon1, lat1, lon2, lat2):
    lon1, lat1, lon2, lat2 = map(radians, [lon1, lat1, lon2, lat2])
    dlon, dlat = lon2 - lon1, lat2 - lat1
    a = sin(dlat/2)**2 + cos(lat1) * cos(lat2) * sin(dlon/2)**2
    return 6371 * 2 * asin(sqrt(a))

# --- [머신러닝] 역별 상권 특성 추출 ---
def get_station_features(station_row, stores_df):
    s_lat, s_lon = station_row['위도'], station_row['경도']
    nearby = stores_df[
        (stores_df['위도'].between(s_lat - 0.01, s_lat + 0.01)) & 
        (stores_df['경도'].between(s_lon - 0.01, s_lon + 0.01))
    ].copy()
    
    if nearby.empty: return pd.Series([0, 0.0, 0.0, 0])
    
    nearby['dist'] = nearby.apply(lambda x: haversine(s_lon, s_lat, x['경도'], x['위도']), axis=1)
    in_500m = nearby[nearby['dist'] <= 0.5]
    
    total_count = len(in_500m)
    if total_count == 0: return pd.Series([0, 0.0, 0.0, 0])
    
    p_ratio = round(in_500m['브랜드명'].isin(premium_brands).sum() / total_count, 2)
    b_ratio = round(in_500m['브랜드명'].isin(budget_brands).sum() / total_count, 2)
    diversity = in_500m['브랜드명'].nunique()
    
    return pd.Series([total_count, p_ratio, b_ratio, diversity])

# 전역 데이터 변수
STATION_ANALYSIS_RESULTS = []
RAW_STATIONS_DF = pd.DataFrame()
COFFEE_STORES_DF = pd.DataFrame()

def run_realtime_clustering():
    global STATION_ANALYSIS_RESULTS, RAW_STATIONS_DF, COFFEE_STORES_DF
    print("🚀 데이터 로딩 및 머신러닝 분석 시작...")

    # 1. 데이터 로드 (MySQL & CSV)
    # MySQL의 coffee_chain 테이블에서 매장명과 주소 컬럼도 함께 가져오도록 수정
    COFFEE_STORES_DF = pd.read_sql("SELECT 브랜드명, 매장명, 주소, 경도, 위도 FROM coffee_chain", engine)
    
    # 노선명이 정제된 v42 파일 로드
    RAW_STATIONS_DF = pd.read_csv('전체_역사정보_최종_정제_v43.csv')
    stations = RAW_STATIONS_DF.dropna(subset=['위도', '경도']).copy()
    stations['총_승하차객수'] = stations['1월 승차이용객수'] + stations['1월 하차이용객수']

    # 2. 지표 계산 및 클러스터링 (기존 로직 유지)
    features = stations.apply(lambda x: get_station_features(x, COFFEE_STORES_DF), axis=1)
    features.columns = ['브랜드_밀도', '프리미엄_비율', '가성비_비율', '브랜드_다양성']
    final_df = pd.concat([stations, features], axis=1)

    target_cols = ['총_승하차객수', '브랜드_밀도', '프리미엄_비율', '가성비_비율', '브랜드_다양성']
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(final_df[target_cols])
    
    kmeans = KMeans(n_clusters=4, random_state=42, n_init=10)
    final_df['클러스터'] = kmeans.fit_predict(X_scaled)

    final_df = final_df.sort_values(by=['지역', '노선명', '역명'])
    STATION_ANALYSIS_RESULTS = final_df.fillna("").to_dict(orient='records')
    print(f"✅ 분석 완료! 총 {len(STATION_ANALYSIS_RESULTS)}개 역의 분석 데이터가 준비되었습니다.")

run_realtime_clustering()

# --- [API 엔드포인트] ---

@app.route('/api/stations')
def get_stations():
    return jsonify(STATION_ANALYSIS_RESULTS)

@app.route('/api/brand-analysis', methods=['GET'])
def get_brand_analysis():
    brand = request.args.get('brand')
    if not brand:
        return jsonify({"error": "브랜드명을 입력해주세요."}), 400

    # 해당 브랜드의 전체 매장 데이터 필터링
    brand_stores = COFFEE_STORES_DF[COFFEE_STORES_DF['브랜드명'] == brand].copy()
    
    result = []
    
    # STATION_ANALYSIS_RESULTS를 돌며 각 역 주변 500m 이내 해당 브랜드 매장 탐색
    # (이미 정렬된 리스트이므로 순서가 유지됨)
    for station in STATION_ANALYSIS_RESULTS:
        s_lat, s_lon = station['위도'], station['경도']
        
        # 거리 계산 성능을 위해 1차 필터링
        nearby = brand_stores[
            (brand_stores['위도'].between(s_lat - 0.01, s_lat + 0.01)) & 
            (brand_stores['경도'].between(s_lon - 0.01, s_lon + 0.01))
        ].copy()
        
        if nearby.empty:
            continue
            
        nearby['dist'] = nearby.apply(lambda x: haversine(s_lon, s_lat, x['경도'], x['위도']), axis=1)
        in_500m = nearby[nearby['dist'] <= 0.5]
        
        if not in_500m.empty:
            stores_list = in_500m.apply(lambda x: {
                "name": x['매장명'],
                "address": x['주소']
            }, axis=1).tolist()
            
            result.append({
                "station_name": station['역명'],
                "line": station['노선명'],
                "station_id": str(station['역번호']),
                "stores": stores_list
            })
    
    return jsonify(result)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8000, debug=True)