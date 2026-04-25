import pandas as pd
import json
import sys
import numpy as np

file_path = 'Clinical History writeup.xlsx'
try:
    xl = pd.ExcelFile(file_path)
    all_data = []
    for sheet in xl.sheet_names:
        df = pd.read_excel(file_path, sheet_name=sheet)
        
        # Replace NaN with None (which becomes null in JSON)
        # Using a more robust method:
        df = df.replace({np.nan: None})
        
        # Clean up column names (remove leading/trailing spaces)
        df.columns = [str(c).strip() for c in df.columns]
        
        # Add sheet name as a field
        df['Month'] = sheet
        
        # Convert to list of dicts
        records = df.to_dict(orient='records')
        
        # Filter out completely empty records
        records = [r for r in records if any(v is not None and v != "" for k, v in r.items() if k != 'Month')]
        
        all_data.extend(records)
    
    with open('data.json', 'w') as f:
        # Use simplejson or just ensure we don't have NaN
        json.dump(all_data, f, indent=2)
    print(f"Successfully exported {len(all_data)} records to data.json")
except Exception as e:
    print(f"Error: {e}")
    sys.exit(1)
