from flask import Flask, jsonify
from flask_cors import CORS
import pandas as pd
import os

app = Flask(__name__)
CORS(app)

@app.route('/api/stations', methods=['GET'])
def get_stations():
    file_path = '역세권_상권분석_서울_v2.csv'
    
    if not os.path.exists(file_path):
        return jsonify({"error": "데이터 파일을 찾을 수 없습니다."}), 404
    
    try:
        df = pd.read_csv(file_path)
        df = df.fillna("") 
        return jsonify(df.to_dict(orient='records'))
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8000, debug=True)