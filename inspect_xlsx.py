import pandas as pd
import json
import sys

file_path = 'Clinical History writeup.xlsx'
try:
    xl = pd.ExcelFile(file_path)
    all_data = []
    for sheet in xl.sheet_names:
        df = pd.read_excel(file_path, sheet_name=sheet)
        # Drop completely empty rows and columns
        df = df.dropna(how='all').dropna(axis=1, how='all')
        # Clean up column names (remove leading/trailing spaces)
        df.columns = [str(c).strip() for c in df.columns]
        # Replace NaN with None (becomes null in JSON)
        df = df.where(pd.notnull(df), None)
        # Add sheet name as a field
        df['Month'] = sheet
        all_data.extend(df.to_dict(orient='records'))
    
    with open('data.json', 'w') as f:
        json.dump(all_data, f, indent=2, default=str)
    print(f"Successfully exported {len(all_data)} records to data.json")
except Exception as e:
    print(f"Error: {e}")
    sys.exit(1)
