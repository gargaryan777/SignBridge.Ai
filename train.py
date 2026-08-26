import pandas as pd
import numpy as np
import joblib
import matplotlib.pyplot as plt
import seaborn as sns

from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder, StandardScaler
from sklearn.metrics import classification_report, confusion_matrix
from sklearn.ensemble import RandomForestClassifier


# ==============================
# 1. Load Dataset
# ==============================

data = pd.read_csv("gesture_data.csv", header=None)

if data.shape[0] == 0:
    print("Dataset is empty. Collect data first.")
    exit()

print("Original Class Distribution:")
print(data.iloc[:, -1].value_counts())


# ==============================
# 2. Data Preparation & Balancing
# ==============================
# We used to throw away hundreds of valid rows to match the smallest class.
# Now, we keep ALL data and use algorithmic balancing, drastically improving accuracy!

# Filter out rows without hand data (all zeros)
non_zero_mask = (data.iloc[:, :-1] != 0).any(axis=1)
data = data[non_zero_mask]
print(f"Removed {len(non_zero_mask) - data.shape[0]} empty rows. Final valid rows: {data.shape[0]}")

label_column = data.columns[-1]

print("\nRetaining all data for maximum efficiency. Class distribution remains:")
print(data[label_column].value_counts())


# ==============================
# 3. Separate Features and Labels
# ==============================

X = data.iloc[:, :-1].values
y = data.iloc[:, -1]


# ==============================
# 3.5 Feature Engineering: Wrist-Relative + Scale Normalization
# ==============================
# This is the KEY accuracy booster. Instead of raw screen coordinates,
# we convert to wrist-relative coordinates and normalize by hand size.
# This means the model learns HAND SHAPE, not hand position on screen.

def normalize_landmarks(raw_row):
    """
    Takes a flat array of 126 values (2 hands * 21 landmarks * 3 coords)
    and returns wrist-relative, scale-normalized features.
    """
    row = np.array(raw_row, dtype=np.float64)
    result = np.zeros_like(row)
    
    # Process each hand (0-62 = hand1, 63-125 = hand2)
    for hand_idx in range(2):
        start = hand_idx * 63  # 21 landmarks * 3 coords = 63
        end = start + 63
        hand = row[start:end]
        
        # Check if hand data exists (not all zeros)
        if np.all(hand == 0):
            result[start:end] = 0
            continue
        
        # Wrist is landmark 0 (first 3 values)
        wrist_x, wrist_y, wrist_z = hand[0], hand[1], hand[2]
        
        # Subtract wrist position from all landmarks (make wrist = origin)
        for i in range(21):
            idx = i * 3
            hand[idx]     -= wrist_x
            hand[idx + 1] -= wrist_y
            hand[idx + 2] -= wrist_z
        
        # Find max distance from wrist (for scale normalization)
        max_dist = 0
        for i in range(21):
            idx = i * 3
            dist = np.sqrt(hand[idx]**2 + hand[idx+1]**2 + hand[idx+2]**2)
            if dist > max_dist:
                max_dist = dist
        
        # Normalize by max distance (so all values fall roughly between -1 and 1)
        if max_dist > 0:
            hand = hand / max_dist
        
        result[start:end] = hand
    
    return result

print("\nApplying wrist-relative normalization to all samples...")
X_normalized = np.array([normalize_landmarks(row) for row in X])
print(f"Normalized {X_normalized.shape[0]} samples successfully.")


# ==============================
# 4. Encode Labels
# ==============================

le = LabelEncoder()
y_encoded = le.fit_transform(y)


# ==============================
# 5. Feature Scaling
# ==============================

scaler = StandardScaler()
X_scaled = scaler.fit_transform(X_normalized)


# ==============================
# 6. Train/Test Split
# ==============================

X_train, X_test, y_train, y_test = train_test_split(
    X_scaled,
    y_encoded,
    test_size=0.2,
    random_state=42,
    stratify=y_encoded
)


# ==============================
# 7. Train Model (Optimized RandomForest — Fast Inference)
# ==============================

model = RandomForestClassifier(
    n_estimators=300,
    max_depth=30,
    min_samples_leaf=2,
    class_weight="balanced_subsample",
    n_jobs=-1,
    random_state=42
)

print("\nTraining model...")
model.fit(X_train, y_train)
print("Training complete!")


# ==============================
# 8. Evaluate
# ==============================

y_pred = model.predict(X_test)

accuracy = model.score(X_test, y_test)
print("\nAccuracy:", accuracy)

print("\nLabel Mapping:")
print(le.classes_)

print("\nClassification Report:")
print(classification_report(y_test, y_pred))


# ==============================
# 9. Confusion Matrix
# ==============================

cm = confusion_matrix(y_test, y_pred)

plt.figure(figsize=(10, 8))
sns.heatmap(
    cm,
    annot=True,
    fmt='d',
    xticklabels=le.classes_,
    yticklabels=le.classes_
)
plt.title("Confusion Matrix")
plt.xlabel("Predicted")
plt.ylabel("Actual")
plt.tight_layout()
plt.savefig("confusion_matrix.png")
plt.close()

print("\nConfusion matrix saved as confusion_matrix.png")


# ==============================
# 10. Save Model Files
# ==============================

joblib.dump(model, "gesture_model.pkl", compress=3)
joblib.dump(le, "label_encoder.pkl")
joblib.dump(scaler, "scaler.pkl")

print("\nModel, encoder and scaler saved successfully.")