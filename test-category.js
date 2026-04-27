// Prueba rápida para insertar un tag con categoría
const test = async () => {
   await TagMap.create({
       original: "camioneta",
       canonical: "truck",
       category: "Vehicles"
   });
   console.log("✅ Columna categoría funcionando correctamente");
};