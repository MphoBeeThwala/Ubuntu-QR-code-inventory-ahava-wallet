part of 'offline_inventory_storage.dart';

class OfflineInventoryItemAdapter extends TypeAdapter<OfflineInventoryItem> {
  @override
  final int typeId = 0;

  @override
  OfflineInventoryItem read(BinaryReader reader) {
    final numOfFields = reader.readByte();
    final fields = <int, dynamic>{
      for (var i = 0; i < numOfFields; i++) reader.readByte(): reader.read(),
    };
    return OfflineInventoryItem(
      qrHash: fields[0] as String,
      qrId: fields[1] as String,
      printedAt: fields[2] as DateTime,
      status: fields[3] as String,
    );
  }

  @override
  void write(BinaryWriter writer, OfflineInventoryItem obj) {
    writer
      ..writeByte(4)
      ..writeByte(0)
      ..write(obj.qrHash)
      ..writeByte(1)
      ..write(obj.qrId)
      ..writeByte(2)
      ..write(obj.printedAt)
      ..writeByte(3)
      ..write(obj.status);
  }

  @override
  int get hashCode => typeId.hashCode;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is OfflineInventoryItemAdapter &&
          runtimeType == other.runtimeType &&
          typeId == other.typeId;
}

