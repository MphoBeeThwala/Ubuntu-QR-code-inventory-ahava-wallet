import 'package:hive_flutter/hive_flutter.dart';

part 'offline_inventory_storage.g.dart';

@HiveType(typeId: 0)
class OfflineInventoryItem extends HiveObject {
  @HiveField(0)
  final String qrHash;

  @HiveField(1)
  final String qrId;

  @HiveField(2)
  final DateTime printedAt;

  @HiveField(3)
  final String status; // e.g. 'UNASSIGNED', 'LINKED'

  OfflineInventoryItem({
    required this.qrHash,
    required this.qrId,
    required this.printedAt,
    required this.status,
  });
}

class OfflineInventoryStorage {
  static const String _boxName = 'agent_inventory_box';

  static Future<void> initialise() async {
    await Hive.initFlutter();
    Hive.registerAdapter(OfflineInventoryItemAdapter());
    await Hive.openBox<OfflineInventoryItem>(_boxName);
  }

  Box<OfflineInventoryItem> get _box => Hive.box<OfflineInventoryItem>(_boxName);

  Future<void> saveInventoryItem(OfflineInventoryItem item) async {
    await _box.put(item.qrHash, item);
  }

  Future<void> saveInventoryItems(List<OfflineInventoryItem> items) async {
    final Map<String, OfflineInventoryItem> entries = {
      for (var item in items) item.qrHash: item
    };
    await _box.putAll(entries);
  }

  List<OfflineInventoryItem> getAllItems() {
    return _box.values.toList();
  }

  List<OfflineInventoryItem> getUnassignedItems() {
    return _box.values.where((item) => item.status == 'UNASSIGNED').toList();
  }

  Future<void> updateItemStatus(String qrHash, String newStatus) async {
    final item = _box.get(qrHash);
    if (item != null) {
      final updated = OfflineInventoryItem(
        qrHash: item.qrHash,
        qrId: item.qrId,
        printedAt: item.printedAt,
        status: newStatus,
      );
      await _box.put(qrHash, updated);
    }
  }

  Future<void> clearInventory() async {
    await _box.clear();
  }
}